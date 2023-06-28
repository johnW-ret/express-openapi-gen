import ts from 'typescript';

type Router = { node: ts.Node, route: string, routers: Router[], routes: Method[] };
type MethodKind = 'get' | 'post' | 'put' | 'delete' | 'patch' | 'options' | 'head';
type HasBodyMethodKind = 'post' | 'put' | 'patch';

interface Method<TMethodKind = MethodKind> {
    method: TMethodKind;
    name: string;
    requestParams: { [name: string]: { type: ts.Type, required: boolean } };
    resBody: ts.Type;
};

interface HasBodyMethod extends Method<HasBodyMethodKind> {
    reqBody: ts.Type;
};

const getRouter = function (root: Router, node: ts.Node) {
    const stack: Router[] = [root];
    let next;

    while ((next = stack.pop()) != null) {
        if (next.node === node)
            return next;

        stack.push(...next.routers);
    }
};

function getDeclarationFromImportSpecifier(importNode: ts.ImportSpecifier, checker: ts.TypeChecker) {
    const originalSymbol = checker.getSymbolAtLocation(importNode.name);

    if (!originalSymbol)
        return;

    const symbol = checker.getAliasedSymbol(originalSymbol);
    const declaration = symbol?.declarations?.[0];
    return declaration;
}

function getRightHandSide(node: ts.Expression, checker: ts.TypeChecker): ts.Expression | undefined {
    if (!ts.isIdentifier(node))
        return node;

    const symbol = checker.getSymbolAtLocation(node);
    if (!symbol)
        return node;

    const declarations = symbol.getDeclarations();
    if (!declarations)
        return node;

    let declaration = declarations[0];
    if (ts.isVariableDeclaration(declaration)) {
        return declaration.initializer;
    }
    else if (ts.isImportSpecifier(declaration)) {
        declaration = getDeclarationFromImportSpecifier(declaration, checker) ?? declaration;

        if (declaration && ts.isVariableDeclaration(declaration)) {
            return declaration.initializer;
        }
    }

    return node;
}

function getRootCallExpression(node: ts.Expression): ts.Expression {
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

                let router = getRightHandSide(leftHandSide, checker);
                if (!router)
                    return;

                if (!(router = getRootCallExpression(router)))
                    return;

                if (methodType === "use") {
                    let connectingRouter = getRightHandSide(node.arguments[1], checker);
                    if (!connectingRouter)
                        return;

                    router = getRootCallExpression(router);
                    connectingRouter = getRootCallExpression(connectingRouter);

                    getRouter(express, router)?.routers.push({
                        node: connectingRouter,
                        route: node.arguments[0]
                            .getText()
                            // this whole section should be replaced
                            // to also look for an identifier and get definition
                            .slice(1, -1),
                        routers: [],
                        routes: []
                    });
                    return;
                }

                let [route, handler] = node.arguments;

                if (!ts.isFunctionLike(handler))
                    return;

                const gethandlerTypes = function (reqParameter: ts.ParameterDeclaration): ts.Type[] {
                    if (!reqParameter?.name)
                        return [];

                    const expressRequestType = checker.getTypeAtLocation(reqParameter.name);
                    return checker.getTypeArguments(expressRequestType as ts.TypeReference).slice(1, 4);
                }

                const [resBody, reqBody, reqQuery] = gethandlerTypes(handler.parameters[0]);

                schema.add(resBody);
                schema.add(reqBody);

                switch (methodType) {
                    case 'post':
                    case 'put':
                    case 'patch':
                        const method: HasBodyMethod = {
                            method: methodType,
                            name: route.getText()
                                .slice(1, -1),
                            requestParams: {},
                            reqBody,
                            resBody
                        };
                        getRouter(express, router)?.routes.push(method);
                    case 'get':
                    case 'delete':
                    case 'options':
                    case 'head':
                        getRouter(express, router)?.routes.push({
                            method: methodType,
                            name: route.getText()
                                .slice(1, -1),
                            requestParams: {},
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