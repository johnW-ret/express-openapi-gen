import ts from 'typescript';

interface IMetadata {
    description?: string;
    summary?: string;
    tags: Set<string>;
}

class Metadata implements IMetadata {
    description?: string;
    summary?: string;
    tags: Set<string> = new Set<string>();
}

interface Router { node: ts.Node, routerPaths: RouterPath[], routes: Method[] };
interface BaseRouterPath extends IMetadata { router: Router };
interface RouterPath extends BaseRouterPath { route: string };
interface UnconnectedRouterPath extends BaseRouterPath { };

type MethodKind = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
type HasBodyMethodKind = 'post' | 'put' | 'patch';
type ParameterLocation = 'path' | 'body' | 'query';
interface RequestParameters { [name: string]: { type: ts.Type, in: ParameterLocation, required: boolean } };

interface Method<TMethodKind = MethodKind> extends IMetadata {
    method: TMethodKind;
    name: string;
    requestParams: RequestParameters;
    resBody: ts.Type;
};

interface HasBodyMethod extends Method<HasBodyMethodKind> {
    reqBody: ts.Type;
};

/* @internal - from typescript 3.9 codebase*/
const enum TypeMapKind {
    Simple,
    Array,
    Function,
    Composite,
    Merged,
}

// modified from https://stackoverflow.com/a/62136593
/* @internal - from typescript 3.9 codebase*/
type TypeMapper =
    | { kind: TypeMapKind.Simple, source: ts.Type, target: ts.Type }
    | { kind: TypeMapKind.Array, sources: readonly ts.Type[], targets: readonly ts.Type[] | undefined }
    | { kind: TypeMapKind.Function, func: (t: ts.Type) => ts.Type }
    | { kind: TypeMapKind.Composite | TypeMapKind.Merged, mapper1: TypeMapper, mapper2: TypeMapper };

/* basic application of the mapper - recursive for composite.*/
function typeMapper(mapper: TypeMapper, source: ts.Type): ts.Type {
    switch (mapper.kind) {
        case TypeMapKind.Simple:
            return mapper.target;
        case TypeMapKind.Array:
            return mapper.targets![mapper.sources.indexOf(source)]
        case TypeMapKind.Function:
            return mapper.func(source);
        case TypeMapKind.Composite:
        case TypeMapKind.Merged:
            return typeMapper(mapper.mapper2, source);
    }
}

function inferTypeArguments(node: ts.CallExpression, typeChecker: ts.TypeChecker): ts.Type[] {
    const signature: any = typeChecker.getResolvedSignature(node);
    const targetParams: ts.TypeParameter[] = signature['target'] && signature['target'].typeParameters;

    if (!targetParams) {
        return [];
    }

    if (signature['mapper'] == undefined)
        return targetParams;

    //typescript <= 3.8
    if (typeof signature['mapper'] == "function")
        return targetParams.map(p => signature['mapper'](p));
    //typescript >= 3.9.... 
    return targetParams.map(p => typeMapper(signature['mapper'] as TypeMapper, p));
}

function getRouterPath(root: BaseRouterPath, node: ts.Node) {
    const stack = [root];
    let next;

    while ((next = stack.pop()) != null) {
        if (next.router.node === node)
            return next;

        stack.push(...next.router.routerPaths);
    }
};

function getFirstRouterPathFromArray(array: Array<BaseRouterPath>, node: ts.Node): BaseRouterPath | undefined {
    let found;
    array.find(router => {
        found = getRouterPath(router, node);
    });

    return found;
}

function getAliasedDeclarations(declaration: ts.NamedDeclaration, index: number, checker: ts.TypeChecker) {
    const originalSymbol = checker.getSymbolAtLocation(declaration.name!);

    if (!originalSymbol)
        return;

    const symbol = checker.getAliasedSymbol(originalSymbol);
    return symbol?.declarations?.[0];
}

function getRightHandSide(node: ts.Expression, checker: ts.TypeChecker): ts.Node | undefined {
    if (!ts.isIdentifier(node))
        return node;

    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol)
        return node;

    const declarations = symbol.getDeclarations();
    if (!declarations)
        return node;

    let declaration = declarations[0];
    if (!declaration)
        return node;

    if (ts.isFunctionDeclaration(declaration)) {
        return declaration;
    }

    if (ts.isVariableDeclaration(declaration)) {
        return declaration.initializer;
    }
    else if (ts.isImportSpecifier(declaration)) {
        declaration = getAliasedDeclarations(declaration, 0, checker) ?? declaration;

        if (declaration && ts.isVariableDeclaration(declaration)) {
            return declaration.initializer;
        }
    } else if (ts.isImportClause(declaration)) {
        const alias = getAliasedDeclarations(declaration, 0, checker);

        if (alias && ts.isExportAssignment(alias)) {
            return alias.expression;
        }
    }

    return node;
}

function getRootCallExpression(node: ts.Node): ts.Node {
    let lastCallExpression;
    let next: ts.Node = node;
    while (next != null) {
        if (ts.isCallExpression(next))
            lastCallExpression = next;

        next = next.getChildAt(0);
    }

    return lastCallExpression ?? node;
}

function isNullableType(type: ts.Type): boolean {
    return (
        (ts.TypeFlags.Null & type.flags) !== 0 ||
        (ts.TypeFlags.Undefined & type.flags) !== 0 ||
        (ts.TypeFlags.Void & type.flags) !== 0
    );
}

export const generateSwaggerDoc = function (entryPoints?: string[]) {
    entryPoints ??= [process.argv[1]];

    const program = ts.createProgram({
        rootNames: entryPoints,
        options:
        {
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.NodeNext,
            allowJs: true,
            checkJs: true
        }
    });

    const checker = program.getTypeChecker();

    let spec: any = {
        openapi: "3.0.3",
        paths: {}
    };

    let nodes: { node: ts.Node, depth: string }[] = program.getSourceFiles()
        .filter(sf => !sf.isDeclarationFile)
        .map((sf) => { return { node: sf, depth: "" } });

    if (nodes.length === 0) {
        console.error(`express-openapi-gen: No source files could not be loaded from ${entryPoints}`);
        return spec;
    }

    let express: RouterPath | undefined;
    let unhookedRouterPaths: { [pos: number]: UnconnectedRouterPath } = {};
    let schema = new Set<ts.Type>();

    {
        let next;
        while ((next = nodes.pop()) != undefined) {
            let { node, depth } = next;

            // console.log(`${depth}${node.kind}${node.getText().replace(/[\n\r]/g, "").slice(0, 17)}`);

            // just a lambda so I can use guard statements
            (() => {
                // get first instance of express
                if (!ts.isCallExpression(node))
                    return;

                if (!express) {
                    const type = checker.getTypeAtLocation(node);

                    if (checker.typeToString(type) == "Express")
                        express = {
                            router: {
                                node: getRootCallExpression(node),
                                routerPaths: [],
                                routes: []
                            },
                            route: '',
                            tags: new Set<string>(),
                        };
                    return;
                }

                const expression = node.expression;

                if (node.arguments.length < 2
                    || !ts.isPropertyAccessExpression(expression))
                    return;

                const methodType = expression.name.getText();
                const leftHandSide = expression.expression;

                let baseRouterExpression = getRightHandSide(leftHandSide, checker);
                if (!baseRouterExpression)
                    return;

                if (!(baseRouterExpression = getRootCallExpression(baseRouterExpression)))
                    return;

                let metadata = new Metadata();

                // may have to change this for 'fluent' api style
                if (node.parent.kind === ts.SyntaxKind.ExpressionStatement) {
                    ts.getJSDocTags(node.parent).forEach(tag => {
                        switch (tag.tagName.text) {
                            case 'description':
                                metadata.description = tag.comment?.toString();
                                break;
                            case 'summary':
                                metadata.summary = tag.comment?.toString();
                                break;
                            case 'tags':
                                if (typeof (tag.comment) === 'string') {
                                    tag.comment?.split(',').forEach(tag => {
                                        metadata.tags.add(tag.trim());
                                    });
                                }
                                break;
                            default:
                                break;
                        }
                    });
                }

                if (methodType === "use") {
                    const routerArg = node.arguments.find(arg => {
                        const type = checker.getTypeAtLocation(arg);

                        return checker.typeToString(type) === "Router";
                    });
                    if (!routerArg)
                        return;

                    let connectingRouterNode = getRightHandSide(routerArg, checker);
                    if (!connectingRouterNode)
                        return;

                    connectingRouterNode = getRootCallExpression(connectingRouterNode);

                    // change this to try to evaluate for when not given a string literal
                    const routeText = checker.typeToString(checker.getTypeAtLocation(node.arguments[0])).slice(1, -1);

                    // if the router has not been hooked up yet
                    let baseRouter = getRouterPath(express, baseRouterExpression)
                        // try getting the base router by searching the tree    
                        ?? getFirstRouterPathFromArray(Object.entries(unhookedRouterPaths)
                            .map(([key, unconnectedRouter]) => unconnectedRouter), baseRouterExpression)
                        // if that fails, try getting the base router from the unhooked routers
                        ?? (unhookedRouterPaths[baseRouterExpression.pos] = {
                            router: {
                                node: baseRouterExpression,
                                routerPaths: [],
                                routes: []
                            },
                            ...metadata
                        });

                    // try to get a router if it already exists
                    let router = getRouterPath(express, connectingRouterNode)?.router;

                    let connectingRouter = unhookedRouterPaths[connectingRouterNode.pos];

                    if (connectingRouter) {
                        baseRouter.router.routerPaths.push({
                            ...connectingRouter,
                            route: routeText,
                            ...metadata
                        });
                        delete unhookedRouterPaths[baseRouterExpression.pos];
                        return;
                    }

                    baseRouter.router.routerPaths.push({
                        router: router ?? {
                            node: connectingRouterNode,
                            routerPaths: [],
                            routes: []
                        },
                        route: routeText,
                        ...metadata
                    });
                    return;
                }

                const callSignatureType = checker.getTypeAtLocation(expression);

                if (!checker.typeToString(callSignatureType).includes("IRouterMatcher"))
                    return;

                const matcherTypes = inferTypeArguments(node, checker);

                let [route, paramsDict, resBody, reqBody, reqQuery] = matcherTypes;

                if (matcherTypes.length == 5) {
                    [paramsDict, resBody, reqBody, reqQuery] = matcherTypes;
                    route = checker.getTypeAtLocation(node.arguments[0]);
                }

                resBody ??= checker.getAnyType();
                reqBody ??= checker.getAnyType();
                schema.add(resBody);
                schema.add(reqBody);

                let requestParams: RequestParameters = {};

                paramsDict?.getApparentProperties().forEach(p => {
                    const type = checker.getTypeOfSymbol(p);
                    schema.add(type);

                    requestParams[p.name] = {
                        type,
                        in: "path",
                        required: isNullableType(type)
                    }
                });

                // if the router has not been hooked up yet
                let routerPath: RouterPath | UnconnectedRouterPath | undefined =
                    // try getting the base router by searching the tree    
                    getRouterPath(express, baseRouterExpression)
                    // if that fails, try getting the base router from the unhooked routers
                    ?? getFirstRouterPathFromArray(Object.entries(unhookedRouterPaths)
                        .map(([key, unconnectedRouterPath]) => unconnectedRouterPath), baseRouterExpression);

                if (!routerPath) {
                    let unhookedRouter = unhookedRouterPaths[baseRouterExpression.pos];

                    if (unhookedRouter !== undefined) {
                        routerPath = unhookedRouter;
                    } else {
                        routerPath = unhookedRouterPaths[baseRouterExpression.pos] = {
                            router:
                                getRouterPath(express, baseRouterExpression)?.router
                                ?? {
                                    node: baseRouterExpression,
                                    routerPaths: [],
                                    routes: []
                                },
                            tags: new Set<string>(),
                        };
                    }
                }

                switch (methodType) {
                    case 'post':
                    case 'put':
                    case 'patch':
                        const method: HasBodyMethod = {
                            method: methodType,
                            name: checker.typeToString(route)
                                .slice(1, -1),
                            requestParams,
                            reqBody,
                            resBody,
                            ...metadata
                        };
                        routerPath.router.routes.push(method);
                    case 'get':
                    case 'delete':
                    case 'options':
                    case 'head':
                        routerPath.router.routes.push({
                            method: methodType,
                            name: checker.typeToString(route)
                                .slice(1, -1),
                            requestParams,
                            resBody,
                            ...metadata
                        });
                        break;
                    default:
                        break;
                }
            })();

            // forEachChild methods skip small tokens like semicolons
            node.getChildren().reverse().forEach(n => nodes.push({ node: n, depth: depth + " " }));
            // node.forEachChild(n => nodes.push({ node: n, depth: depth + " " }));
        }
    }

    if (!express) {
        console.error(`express-openapi-gen: Express could not be found in source file in ${entryPoints}`);
        return spec;
    }

    // define schema
    spec.components = { schemas: {} };

    let methodsBlock: { [qualifiedRoute: string]: Method[] } = {};

    // probably redundant since slash is required for express?
    function addSlashIfNone(route: string): string {
        return (route[0] == '/') ? route : `/${route}`;
    }

    function removeNullableQuestionMarkIfExists(route: string): string {
        return (route.at(-1) == '?') ? route.slice(0, -1) : route;
    }

    function expressParamsInPathToOpenApiParamsInPath(route: string): string {
        const matches = route.matchAll(/:[_\w\d-]+\??/g);

        for (const match of matches) {
            if (match[0])
                route = route.replace(match[0], `{${removeNullableQuestionMarkIfExists(match[0].slice(1))}}`);
        }

        return route;
    }

    function typeToSchema(type: ts.Type): any {
        let seen: ts.Type[] = []; // for infinite cycles

        function rec(type: ts.Type): any {
            const typeName = checker.typeToString(type);

            if (typeName == 'string' || typeName == 'number' || typeName == 'boolean') {
                return {
                    type: typeName
                };
            }
            else if (typeName == 'any') {
                return {
                    type: "object"
                };
            }
            else if (checker.isArrayLikeType(type)) {
                let arrayTypeSchema: any = { type: "object" };

                if (checker.isArrayLikeType(type)) {
                    const arrayType = type as ts.TypeReference;
                    if (arrayType) {
                        const elementType = checker.getTypeArguments(arrayType)[0];
                        arrayTypeSchema = rec(elementType);
                    }
                }
                return {
                    type: 'array',
                    items: arrayTypeSchema
                };
            }
            else {
                // if it's not a known type then just get the direct schema and don't add it to schemas
                if (!type.aliasSymbol) {
                    return {
                        type: "object",
                        properties: type.getApparentProperties()
                            .reduce((a, v) => ({ ...a, [v.name]: rec(checker.getTypeOfSymbol(v)) }), {})
                    };
                }

                if (!spec.components.schemas[typeName]) {
                    // for infinite cycles
                    if (seen.includes(type)) {
                        return {
                            "$ref": `#/components/schemas/${typeName}`
                        };
                    }
                    else {
                        // add to seen
                        seen.push(type);

                        spec.components.schemas[typeName] = {
                            type: "object",
                            properties: type.getApparentProperties()
                                .reduce((a, v) => ({ ...a, [v.name]: rec(checker.getTypeOfSymbol(v)) }), {})
                        };
                    }
                }

                return {
                    "$ref": `#/components/schemas/${typeName}`
                };
            }
        }

        return rec(type);
    }

    // extract methods from router tree
    type Item = { routerPath: RouterPath, route: string, tags: Set<string> };
    const stack: Item[] = [{ routerPath: express, route: express.route, tags: new Set<string>(express.tags) }];
    let next: Item | undefined;

    while ((next = stack.pop()) != undefined) {
        next.routerPath.router.routes
            .forEach(route => {

                (methodsBlock[`${next!.route}${expressParamsInPathToOpenApiParamsInPath(addSlashIfNone(route.name))}`] ??= [])
                    .push({
                        ...route, tags: new Set<string>([...next!.routerPath.tags, ...route.tags, ...Array.from(next!.tags.values())])//new Set<string>([...next!.tags, ...route.tags.values()])})
                    });
            });

        next.routerPath.router.routerPaths.forEach(rp => stack.push({
            routerPath: rp,
            route: `${next!.route}${addSlashIfNone(rp.route)}`,
            tags: new Set<string>([...next!.tags, ...next!.routerPath.tags.values()])
        }));
    }

    // convert methods to json spec
    Object.entries(methodsBlock).map(
        ([route, methods]) => {
            methods.forEach(m => {
                spec.paths[route] ??= {};
                spec.paths[route][m.method] ??= {};

                spec.paths[route][m.method].summary = m.summary;
                spec.paths[route][m.method].description = m.description;
                spec.paths[route][m.method].tags = Array.from(m.tags);

                function isHasRequestBody(m: Method): m is HasBodyMethod {
                    return (<HasBodyMethod>m).reqBody !== undefined;
                }

                spec.paths[route][m.method].parameters = Object.entries(m.requestParams).map(([name, param]) => {
                    return {
                        name,
                        in: param.in,
                        required: param.required,
                        schema: typeToSchema(param.type)
                    }
                });

                if ((m.method == 'post' || m.method == 'put' || m.method == 'patch')
                    && isHasRequestBody(m)) {

                    spec.paths[route][m.method].requestBody = {
                        content: {
                            "application/json": {
                                schema: typeToSchema(m.reqBody)
                            }
                        }
                    }
                }

                spec.paths[route][m.method]['responses'] = {
                    "200": {
                        "description": "success",
                        content: {
                            "application/json": {
                                schema: typeToSchema(m.resBody)
                            }
                        }
                    }

                }
            });
        }
    );

    return spec;
}