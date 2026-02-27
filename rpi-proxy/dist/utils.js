"use strict";
/**
 * Shared utility functions for the RPI proxy.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendJsonError = sendJsonError;
exports.sendJson = sendJson;
/** Send a JSON error response with CORS headers */
function sendJsonError(res, status, body) {
    if (res.headersSent)
        return;
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': '*',
    });
    res.end(json);
}
/** Send a JSON success response with CORS headers */
function sendJson(res, status, body) {
    if (res.headersSent)
        return;
    const json = JSON.stringify(body);
    res.writeHead(status, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(json),
        'Access-Control-Allow-Origin': '*',
    });
    res.end(json);
}
//# sourceMappingURL=utils.js.map