const test = require("node:test");
const assert = require("node:assert/strict");
const {
  toIdString,
  getConversationMemberIds,
  hasConversationAccess,
  canExchangeInConversation,
} = require("../utils/socketAuthorization");

test("toIdString normalizes primitive and object ids", () => {
  assert.equal(toIdString(" abc "), "abc");
  assert.equal(toIdString({ _id: "user-1" }), "user-1");
  assert.equal(toIdString(null), null);
});

test("getConversationMemberIds extracts unique member ids", () => {
  const conversation = {
    members: [{ _id: "u1" }, "u2", { _id: "u1" }, { toString: () => "u3" }],
  };

  assert.deepEqual(getConversationMemberIds(conversation), ["u1", "u2", "u3"]);
});

test("hasConversationAccess checks membership correctly", () => {
  const conversation = { members: ["u1", "u2"] };
  assert.equal(hasConversationAccess(conversation, "u1"), true);
  assert.equal(hasConversationAccess(conversation, "u9"), false);
});

test("canExchangeInConversation requires both sender and receiver membership", () => {
  const conversation = { members: ["u1", "u2", "u3"] };

  assert.equal(canExchangeInConversation(conversation, "u1", "u2"), true);
  assert.equal(canExchangeInConversation(conversation, "u1", "u9"), false);
  assert.equal(canExchangeInConversation(conversation, "u1", "u1"), false);
});