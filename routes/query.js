var u = require('./utils');

// Run a Mongoose query; if MongoDB rejects the query itself (bad operator,
// mixed include/exclude in select, a non-ObjectId compared to _id...) it's the client's fault -> 400
async function runQuery(query) {
    try {
        return await query.exec();
    } catch (err) {
        if (err.name === 'CastError' || err.name === 'MongoServerError' || err.name === 'StrictModeError') {
            throw new u.ApiError(400, 'Invalid query parameters');
        }
        throw err;   // anything else (e.g. database down) -> 500
    }
}

// GET /users, GET /tasks
function listHandler(Model, defaultLimit) {
    return async function (req, res) {
        var where  = u.parseObjectParam(req.query, 'where') || {};
        var sort   = u.parseFieldMapParam(req.query, 'sort', [1, -1]);
        var select = u.parseFieldMapParam(req.query, 'select', [0, 1]);
        var skip   = u.parseNonNegIntParam(req.query, 'skip');
        var limit  = u.parseNonNegIntParam(req.query, 'limit');
        var count  = u.parseBoolParam(req.query, 'count');

        // All filtering/sorting/paging is done by MongoDB (README requirement 5)
        var query = count ? Model.countDocuments(where) : Model.find(where);
        if (!count && sort)   query.sort(sort);
        if (!count && select) query.select(select);
        if (skip !== undefined) query.skip(skip);
        if (limit !== undefined) query.limit(limit);
        else if (!count && defaultLimit) query.limit(defaultLimit);

        var result = await runQuery(query);
        return u.send(res, 200, 'OK', result);
    };
}

// GET /users/:id, GET /tasks/:id  (only `select` applies)
function getOneHandler(Model, label) {
    return async function (req, res) {
        if (!u.isValidId(req.params.id)) throw new u.ApiError(404, label + ' not found');
        var select = u.parseFieldMapParam(req.query, 'select', [0, 1]);

        var query = Model.findById(req.params.id);
        if (select) query.select(select);

        var doc = await runQuery(query);
        if (!doc) throw new u.ApiError(404, label + ' not found');
        return u.send(res, 200, 'OK', doc);
    };
}

module.exports = { listHandler, getOneHandler };