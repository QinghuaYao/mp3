var express = require('express');
var User = require('../models/user');
var Task = require('../models/task');
var q = require('./query');
var u = require('./utils');

var router = express.Router();

function given(v) { return v !== undefined && v !== null; }

// ---- 1. Check the body's format (no database yet) -> clean fields, or 400 ----
function validateUser(req) {
    var body = req.body || {};

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new u.ApiError(400, 'User name is required');
    }
    if (typeof body.email !== 'string' || body.email.trim() === '') {
        throw new u.ApiError(400, 'User email is required');
    }
    if (!/^[^\s@]+@[^\s@]+$/.test(body.email)) {
        throw new u.ApiError(400, 'User email is not valid');
    }

    var pendingTasks = given(body.pendingTasks) ? body.pendingTasks : [];
    // a form-encoded body with one value sends a plain string instead of a list
    if (typeof pendingTasks === 'string' && req.is('application/x-www-form-urlencoded')) {
        pendingTasks = [pendingTasks];
    }
    if (!Array.isArray(pendingTasks)) throw new u.ApiError(400, 'pendingTasks must be a list of task ids');
    pendingTasks.forEach(function (id) {
        if (!u.isValidId(id)) throw new u.ApiError(400, 'pendingTasks contains an invalid task id');
    });
    pendingTasks = Array.from(new Set(pendingTasks));   // drop duplicates

    return { name: body.name, email: body.email, pendingTasks: pendingTasks };
}

// ---- 2. Checks that need the database (FAQ order: email 400, missing task 404, completed task 400) ----
async function checkUserRefs(fields, userId) {
    // another user with this email? (keeping your own email on PUT is fine)
    var clash = await User.findOne({ email: fields.email, _id: { $ne: userId } });
    if (clash) throw new u.ApiError(400, 'Email is already used by another user');

    if (fields.pendingTasks.length > 0) {
        var tasks = await Task.find({ _id: { $in: fields.pendingTasks } });
        if (tasks.length !== fields.pendingTasks.length) {
            throw new u.ApiError(404, 'A task in pendingTasks does not exist');
        }
        if (tasks.some(function (t) { return t.completed; })) {
            throw new u.ApiError(400, 'pendingTasks cannot contain a completed task');
        }
    }
}

// ---- 3. After the user is saved: fix the tasks (and other users) ----
async function syncTasksForUser(user) {
    var userId = String(user._id);
    var ids = user.pendingTasks;

    // a) pending tasks this user had but are no longer listed -> unassigned
    await Task.updateMany(
        { assignedUser: userId, completed: false, _id: { $nin: ids } },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );

    if (ids.length > 0) {
        // b) listed tasks that belonged to another user -> take them off that user's list
        await User.updateMany(
            { _id: { $ne: user._id }, pendingTasks: { $in: ids } },
            { $pull: { pendingTasks: { $in: ids } } }
        );
        // c) listed tasks -> assigned to this user
        await Task.updateMany({ _id: { $in: ids } }, { $set: { assignedUser: userId } });
    }

    // d) every task of this user (completed ones too) shows the current name
    await Task.updateMany({ assignedUser: userId }, { $set: { assignedUserName: user.name } });
}

// ---- Routes ----
router.get('/', q.listHandler(User, 0));            // users: no default limit
router.get('/:id', q.getOneHandler(User, 'User'));

router.post('/', async function (req, res) {
    var fields = validateUser(req);
    await checkUserRefs(fields, null);
    var user = await User.create(fields);             // dateCreated is set by the schema
    await syncTasksForUser(user);
    return u.send(res, 201, 'User created', user);
});

router.put('/:id', async function (req, res) {
    var user = await u.findByIdOr404(User, req.params.id, 'User');   // URL id first -> 404
    var fields = validateUser(req);
    await checkUserRefs(fields, user._id);
    user.set(fields);                                 // missing pendingTasks -> [] (from validateUser)
    await user.save();
    await syncTasksForUser(user);
    return u.send(res, 200, 'User updated', user);
});

router.delete('/:id', async function (req, res) {
    var user = await u.findByIdOr404(User, req.params.id, 'User');
    await user.deleteOne();
    // all of the user's tasks, completed ones too, become unassigned
    await Task.updateMany(
        { assignedUser: String(user._id) },
        { $set: { assignedUser: '', assignedUserName: 'unassigned' } }
    );
    return res.status(204).end();
});

module.exports = router;