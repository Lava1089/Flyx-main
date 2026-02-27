/**
 * Path-based Router with Middleware Chain
 * Matches request paths to route handlers and runs middleware before dispatch.
 * Requirements: 3.2, 3.7
 */
import type { IncomingMessage, ServerResponse } from 'http';
import type { RouteDefinition, Middleware, RouteHandler } from './types';
export declare class Router {
    private routes;
    private middlewares;
    /** Register a global middleware */
    use(middleware: Middleware): void;
    /** Register a route handler for an exact path */
    route(path: string, handler: RouteHandler): void;
    /**
     * Find the matching route for a given pathname.
     * Uses exact match — routes are checked in registration order.
     */
    match(pathname: string): RouteDefinition | undefined;
    /** Handle an incoming HTTP request */
    handle(raw: IncomingMessage, res: ServerResponse): Promise<void>;
    /** Dispatch to the matching route handler */
    private dispatch;
    /** Get all registered route paths (useful for debugging / tests) */
    getRegisteredPaths(): string[];
}
//# sourceMappingURL=router.d.ts.map