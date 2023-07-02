import ts from 'typescript';

type Router = { node: ts.Node, route: string, routers: Router[], routes: Method[] };
type UnconnectedRouter = { node: ts.Node, routers: Router[], routes: Method[] };
type MethodKind = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
type HasBodyMethodKind = 'post' | 'put' | 'patch';
type ParameterLocation = 'route' | 'body' | 'query';
interface RequestParameters { [name: string]: { type: ts.Type, in: ParameterLocation, required: boolean } };

interface Method<TMethodKind = MethodKind> {
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

function getRouter(root: Router | UnconnectedRouter, node: ts.Node): Router | UnconnectedRouter | undefined {
    const stack = [root];
    let next;

    while ((next = stack.pop()) != null) {
        if (next.node === node)
            return next;

        stack.push(...next.routers);
    }
};

function getFirstRouterFromArray(array: Array<Router | UnconnectedRouter>, node: ts.Node) {
    let found;
    array.find(router => {
        found = getRouter(router, node);
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

    let express: Router | undefined;
    let unhookedRouters: { [pos: number]: UnconnectedRouter } = {};
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
                        express = { node: getRootCallExpression(node), route: '', routers: [], routes: [] };
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


                    let baseRouter = getRouter(express, baseRouterExpression)
                        ?? getFirstRouterFromArray(Object.entries(unhookedRouters)
                            .map(([key, unconnectedRouter]) => unconnectedRouter), baseRouterExpression);

                    if (!baseRouter)
                        return;

                    let connectingRouter = unhookedRouters[connectingRouterNode.pos];

                    if (connectingRouter) {
                        baseRouter.routers.push({
                            ...connectingRouter,
                            route: checker.typeToString(checker.getTypeAtLocation(node.arguments[0]))
                                .slice(1, -1)
                        });
                        delete unhookedRouters[baseRouterExpression.pos];
                        return;
                    }

                    baseRouter.routers.push({
                        node: connectingRouterNode,
                        route: checker.typeToString(checker.getTypeAtLocation(node.arguments[0]))
                            .slice(1, -1),
                        routers: [],
                        routes: []
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
                        in: "route",
                        required: true
                    }
                });

                // if the router has not been hooked up yet
                let router: Router | UnconnectedRouter | undefined = getRouter(express, baseRouterExpression)
                    ?? getFirstRouterFromArray(Object.entries(unhookedRouters)
                        .map(([key, unconnectedRouter]) => unconnectedRouter), baseRouterExpression);

                if (!router) {
                    let unhookedRouter = unhookedRouters[baseRouterExpression.pos];

                    if (unhookedRouter !== undefined) {
                        router = unhookedRouter;
                    } else {
                        router = unhookedRouters[baseRouterExpression.pos] = {
                            node: baseRouterExpression,
                            routers: [],
                            routes: []
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
                            resBody
                        };
                        router.routes.push(method);
                    case 'get':
                    case 'delete':
                    case 'options':
                    case 'head':
                        router.routes.push({
                            method: methodType,
                            name: checker.typeToString(route)
                                .slice(1, -1),
                            requestParams,
                            resBody
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
    // spec.components = {};
    // spec.components.schemas = {};
    // schema.forEach(t => {
    //     const typeName = checker.typeToString(t);

    //     spec.components.schemas[checker.typeToString(t)] = {
    // });

    let methodsBlock: { [qualifiedRoute: string]: Method[] } = {};

    function addSlashIfNone(route: string): string {
        return (route[0] == '/') ? route : `/${route}`;
    }

    // extract methods from router tree
    type Item = { router: Router, route: string };
    const stack: Item[] = [{ router: express, route: express.route }];
    let next: Item | undefined;

    while ((next = stack.pop()) != undefined) {
        next.router.routes
            .forEach(r => (methodsBlock[`${next!.route}${addSlashIfNone(r.name)}`] ??= [])
                .push(r));

        next.router.routers.forEach(r => stack.push({
            router: r,
            route: `${next!.route}${addSlashIfNone(r.route)}`
        }));
    }

    function typeToSchema(type: ts.Type): any {
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
        // make sure this works with javascript arrays
        else if (typeName.startsWith('Array<')) {
            const arrayType = typeName.slice(6, -1);
            return {
                type: 'array',
                items: {
                    type: arrayType
                }
            };
        }
        else {
            // build openapi schema and references later
            const schema: any = {
                type: "object",
                properties: {}
            };

            // don't forget circular references
            // ignore sub-objects for now since we'll need types anyway
            type.getApparentProperties().forEach(p => {
                schema.properties[p.name] = {
                    type: checker.typeToString(checker.getTypeOfSymbol(p))
                };
            });

            return schema;
        }
    }

    // convert methods to json spec
    Object.entries(methodsBlock).map(
        ([route, methods]) => {
            methods.forEach(m => {
                spec.paths[route] ??= {};
                spec.paths[route][m.method] ??= {};

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