var mongoose = require('mongoose');

// An error we throw on purpose; the error handler turns it into { message, data }
class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}

function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data });
}

// A real MongoDB ObjectId string: exactly 24 hex characters
function isValidId(id) {
    return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id);
}

// ?name=<json>  ->  parsed value (or undefined if not given)
function parseJSONParam(query, name) {
    var raw = query[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string') throw new ApiError(400, 'Query parameter "' + name + '" was given more than once');
    try { return JSON.parse(raw); }
    catch (e) { throw new ApiError(400, 'Query parameter "' + name + '" is not valid JSON'); }
}

// where / sort / select must be JSON objects like {"name": 1}
function parseObjectParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        throw new ApiError(400, 'Query parameter "' + name + '" must be a JSON object');
    }
    return value;
}

// sort values must be 1/-1, select values must be 0/1
function parseFieldMapParam(query, name, allowed) {
    var value = parseObjectParam(query, name);
    if (value !== undefined) {
        Object.keys(value).forEach(function (key) {
            if (allowed.indexOf(value[key]) === -1) {
                throw new ApiError(400, 'Query parameter "' + name + '" only allows values ' + allowed.join(' or '));
            }
        });
    }
    return value;
}

// skip / limit
function parseNonNegIntParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value !== undefined && !(Number.isInteger(value) && value >= 0)) {
        throw new ApiError(400, 'Query parameter "' + name + '" must be a non-negative integer');
    }
    return value;
}

// count
function parseBoolParam(query, name) {
    var value = parseJSONParam(query, name);
    if (value !== undefined && typeof value !== 'boolean') {
        throw new ApiError(400, 'Query parameter "' + name + '" must be true or false');
    }
    return value;
}
// Load a document by the :id in the URL; a malformed or unknown id is a 404 (FAQ)
async function findByIdOr404(Model, id, label) {
    if (!isValidId(id)) throw new ApiError(404, label + ' not found');
    var doc = await Model.findById(id);
    if (!doc) throw new ApiError(404, label + ' not found');
    return doc;
}
module.exports = { ApiError, send, isValidId, findByIdOr404, parseObjectParam, parseFieldMapParam, parseNonNegIntParam, parseBoolParam };