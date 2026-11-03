var express = require('express');
var Task = require('../models/task');
var User = require('../models/user');
var q = require('./query');
var u = require('./utils');

var router = express.Router();

function given(v) { return v !== undefined && v !== null; }

// ---- 1. Check the body's format (no database yet) -> clean fields, or 400 ----
function validateTask(body) {
    body = body || {};   // Express 5: req.body is undefined when there is no body

    if (typeof body.name !== 'string' || body.name.trim() === '') {
        throw new u.ApiError(400, 'Task name is required');
    }

    if (!given(body.deadline) || body.deadline === '') throw new u.ApiError(400, 'Task deadline is required');
    if (typeof body.deadline !== 'string' && typeof body.deadline !== 'number') {
        throw new u.ApiError(400, 'Task deadline must be a date');
    }
    // accept "2026-12-01", an ISO string, or milliseconds (number or numeric string)
    var deadline = /^\d+$/.test(String(body.deadline)) ? new Date(Number(body.deadline)) : new Date(body.deadline);
    if (isNaN(deadline.getTime())) throw new u.ApiError(400, 'Task deadline must be a valid date');

    var description = given(body.description) ? body.description : '';
    if (typeof description !== 'string') throw new u.ApiError(400, 'Task description must be a string');

    var completed = given(body.completed) ? body.completed : false;
    if (completed === 'true') completed = true;        // form-encoded bodies send strings
    if (completed === 'false') completed = false;
    if (typeof completed !== 'boolean') throw new u.ApiError(400, 'completed must be true or false');

    var assignedUser = given(body.assignedUser) ? body.assignedUser : '';
    if (typeof assignedUser !== 'string') throw new u.ApiError(400, 'assignedUser must be a user id string');
    if (assignedUser !== '' && !u.isValidId(assignedUser)) {
        throw new u.ApiError(400, 'assignedUser is not a valid user id');
    }

    var assignedUserName = given(body.assignedUserName) ? body.assignedUserName : '';
    if (typeof assignedUserName !== 'string') throw new u.ApiError(400, 'assignedUserName must be a string');
    if (assignedUser === '' && assignedUserName !== '' && assignedUserName !== 'unassigned') {
        throw new u.ApiError(400, 'An unassigned task must have assignedUserName "unassigned"');
    }

    return { name: body.name, description, deadline, completed, assignedUser, assignedUserName };
}

// ---- 2. Check the referenced user exists and the name matches -> 404 / 400 ----
async function resolveAssignee(fields) {
    if (fields.assignedUser === '') {
        fields.assignedUserName = 'unassigned';
        return;
    }
    var user = await User.findById(fields.assignedUser);
    if (!user) throw new u.ApiError(404, 'Assigned user not found');

    if (fields.assignedUserName === '') {
        fields.assignedUserName = user.name;           // omitted -> fill it in
    } else if (fields.assignedUserName !== user.name) {
        throw new u.ApiError(400, 'assignedUserName does not match the assigned user');
    }
}

// ---- 3. After the task is saved: fix every user's pendingTasks ----
// The task belongs in exactly one list: its assigned user's, and only while not completed.
async function syncUsersForTask(task) {
    var id = String(task._id);
    var owner = (task.assignedUser && !task.completed) ? task.assignedUser : null;

    // remove it from everyone else (previous owner, or the owner if it's now completed)
    await User.updateMany({ pendingTasks: id, _id: { $ne: owner } }, { $pull: { pendingTasks: id } });
    if (owner) await User.updateOne({ _id: owner }, { $addToSet: { pendingTasks: id } });
}

// ---- Routes ----
router.get('/', q.listHandler(Task, 100));          // tasks: default limit 100
router.get('/:id', q.getOneHandler(Task, 'Task'));

router.post('/', async function (req, res) {
    var fields = validateTask(req.body);              // 400s
    await resolveAssignee(fields);                    // 404 / 400
    var task = await Task.create(fields);             // dateCreated is set by the schema
    await syncUsersForTask(task);
    return u.send(res, 201, 'Task created', task);
});

router.put('/:id', async function (req, res) {
    var task = await u.findByIdOr404(Task, req.params.id, 'Task');   // URL id first -> 404
    var fields = validateTask(req.body);
    await resolveAssignee(fields);
    task.set(fields);                                 // replace every editable field; _id/dateCreated untouched
    await task.save();
    await syncUsersForTask(task);
    return u.send(res, 200, 'Task updated', task);
});

router.delete('/:id', async function (req, res) {
    var task = await u.findByIdOr404(Task, req.params.id, 'Task');
    await task.deleteOne();
    var id = String(task._id);
    await User.updateMany({ pendingTasks: id }, { $pull: { pendingTasks: id } });
    return res.status(204).end();
});

module.exports = router;