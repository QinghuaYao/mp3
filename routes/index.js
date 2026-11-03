/*
 * Connect all of your endpoints together here.
 */
var u = require('./utils');

module.exports = function (app, router) {
    app.use('/api', require('./home.js')(router));
    app.use('/api/users', require('./users.js'));
    app.use('/api/tasks', require('./tasks.js'));

    // Unknown URL
    app.use(function (req, res) {
        u.send(res, 404, 'Endpoint not found', {});
    });

    // Every error ends up here. Express 5 forwards errors from async handlers automatically.
    app.use(function (err, req, res, next) {
        if (err instanceof u.ApiError) return u.send(res, err.status, err.message, {});
        if (err.type === 'entity.parse.failed') return u.send(res, 400, 'Request body is not valid JSON', {});
        if (err.code === 11000) return u.send(res, 400, 'Email is already used by another user', {});   // unique index race
        if (err.name === 'ValidationError' || err.name === 'CastError') return u.send(res, 400, 'Invalid data', {});
        console.error(err);   // full details stay in the server log, never sent to the client
        return u.send(res, 500, 'Something went wrong on the server', {});
    });
};