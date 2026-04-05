const mongoose = require("mongoose");
const Message = require("../models/Message");
const User = require("../models/User");

const toObjectIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    if (value._id) return String(value._id);
    if (value.id) return String(value.id);
  }
  try {
    return String(value);
  } catch (_) {
    return null;
  }
};

const clip = (value, max) => (typeof value === "string" ? value.slice(0, max) : "");

const normalizeReplyToPayload = async ({ replyTo, conversationId }) => {
  if (!replyTo || !replyTo.messageId || !conversationId) {
    return null;
  }

  const replyMessageId = toObjectIdString(replyTo.messageId);
  const normalizedConversationId = toObjectIdString(conversationId);

  if (!replyMessageId || !normalizedConversationId) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(replyMessageId)) {
    return null;
  }

  if (!mongoose.Types.ObjectId.isValid(normalizedConversationId)) {
    return null;
  }

  const targetMessage = await Message.findById(replyMessageId).select("_id conversationId sender text");
  if (!targetMessage) {
    return null;
  }

  if (String(targetMessage.conversationId) !== normalizedConversationId) {
    return null;
  }

  const senderId = toObjectIdString(targetMessage.sender) || toObjectIdString(replyTo.senderId);
  let senderName = "";
  if (senderId && mongoose.Types.ObjectId.isValid(senderId)) {
    const senderUser = await User.findById(senderId).select("username");
    senderName = senderUser?.username || "";
  }

  return {
    messageId: targetMessage._id,
    text: clip(targetMessage.text, 200) || clip(replyTo.text, 200),
    senderId: senderId || null,
    senderName: clip(senderName || replyTo.senderName, 50),
  };
};

module.exports = {
  normalizeReplyToPayload,
  toObjectIdString,
};
