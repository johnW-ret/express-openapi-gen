import ts from 'typescript';

type Router = { node: ts.Node, route: string, routers: Router[], routes: Method[] };
type MethodKind = 'get' | 'put' | 'post' | 'delete';
// replace with express method?
type Method = { method: MethodKind; route: string; reqType: string; };

const getRouter = function (root: Router, node: ts.Node) {
    const stack: Router[] = [root];
    let next;

    while ((next = stack.pop()) != null) {
        if (next.node === node)
            return next;

        stack.push(...next.routers);
    }
};

function getRightHandSide(node: ts.Expression, checker: ts.TypeChecker): ts.Expression | undefined {
    if (ts.isIdentifier(node)) {
        const symbol = checker.getSymbolAtLocation(node);
        if (symbol) {
            const declarations = symbol.getDeclarations();
            if (declarations) {
                const declaration = declarations[0];
                if (ts.isVariableDeclaration(declaration)) {
                    return declaration.initializer;
                }
            }
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

export const generateSwaggerDoc = function (entryPoint?: string) {
    entryPoint ??= process.argv[1];

    const program = ts.createProgram({
        rootNames: [entryPoint],
        options:
        {
            moduleResolution: ts.ModuleResolutionKind.NodeNext,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ES2022,
            allowJs: true,
            checkJs: true
        }
    });

    const checker = program.getTypeChecker();
    const sourceFile = program.getSourceFile(entryPoint);

    let spec: any = {
        openapi: "3.0.3",
        paths: {}
    };

    if (!sourceFile) {
        console.error(`openapi-gen: Source file could not be loaded at ${entryPoint}`);
        return spec;
    }

    let nodes: { node: ts.Node, depth: string }[] = [{ node: sourceFile, depth: "" }];
    let express: Router | undefined;

    {
        let next;
        while ((next = nodes.pop()) != undefined) {
            let { node, depth } = next;

            // console.log(`${depth}${node.kind}${node.getText().replace(/[\n\r]/g, "").slice(0, 17)}`);

            // just a lambda so I can use guard statements
            (() => {
                if (!ts.isCallExpression(node))
                    return;

                if (!express) {
                    const type = checker.getTypeAtLocation(node);

                    if (checker.typeToString(type) == "Express")
                        express = { node: getRootCallExpression(node), route: '', routers: [], routes: [] };
                    return;
                }

                const expression = node.expression;

                if (!ts.isPropertyAccessExpression(expression))
                    return;

                const methodType = expression.name.getText();
                const leftHandSide = expression.expression;

                switch (methodType) {
                    case "use":
                        if (node.arguments.length < 2)
                            return;

                        let [baseRouter, connectingRouter] = [
                            getRightHandSide(leftHandSide, checker),
                            getRightHandSide(node.arguments[1], checker)
                        ];

                        if (!baseRouter || !connectingRouter)
                            return;

                        baseRouter = getRootCallExpression(baseRouter);
                        connectingRouter = getRootCallExpression(connectingRouter);

                        getRouter(express, baseRouter)?.routers.push({
                            node: connectingRouter,
                            route: node.arguments[0]
                                .getText()
                                // this whole section should be replaced
                                // to also look for an identifier and get definition
                                .slice(1, -1),
                            routers: [],
                            routes: []
                        });
                        break;

                    case "get":
                        let [route, handler] = node.arguments;

                        if (!ts.isFunctionLike(handler))
                            return;

                        const getRequestType = function (parameter: ts.ParameterDeclaration): ts.Type | undefined {
                            if (!parameter?.name)
                                return undefined;

                            const expressRequestType = checker.getTypeAtLocation(parameter.name);
                            return checker.getTypeArguments(expressRequestType as ts.TypeReference)[2];
                        }

                        const reqType = getRequestType(handler.parameters[0]);
                        const reqTypeName = reqType ? checker.typeToString(reqType) : "";

                        let router = getRightHandSide(leftHandSide, checker);
                        if (!router)
                            return;

                        router = getRootCallExpression(router);

                        getRouter(express, router)?.routes.push({
                            method: "get",
                            route: route.getText()
                                .slice(1, -1),
                            reqType: reqTypeName
                        });
                        break;
                    default:
                        break;
                }
            })();

            // forEachChild methods skip small tokens like semicolons
            node.getChildren().reverse().forEach(n => nodes.push({ node: n, depth: depth + " " }));
            // _node.forEachChild(n => nodes.push(n));
        }
    }

    if (!express) {
        console.error(`openapi-gen: Express could not be found in source file in ${entryPoint}`);
        return spec;
    }

    let methodsBlock: { [route: string]: { method: string, reqType: string }[] } = {};

    const addSlashIfNone = function (route: string): string {
        return (route[0] == '/') ? route : `/${route}`;
    }

    // extract methods from router tree
    type Item = { router: Router, route: string };
    const stack: Item[] = [{ router: express, route: express.route }];
    let next: Item | undefined;
    while ((next = stack.pop()) != undefined) {
        next.router.routes.forEach(r => (methodsBlock[`${next!.route}${addSlashIfNone(r.route)}`] ??= [])
            .push({ method: r.method, reqType: r.reqType }));

        next.router.routers.forEach(r => stack.push({
            router: r,
            route: `${next!.route}${addSlashIfNone(r.route)}`
        }));
    }

    // convert methods to json spec
    Object.entries(methodsBlock).map(
        ([route, methods]) => {
            methods.forEach(m => {
                spec.paths[route] ??= {};
                spec.paths[route][m.method] = {
                    "parameters": [
                        {
                            "schema": {
                                type: m.reqType
                            }
                        }
                    ]
                }
            });
        }
    );

    return spec;
}