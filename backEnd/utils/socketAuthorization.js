const toIdString = (value) => {
  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (typeof value === "object") {
    if (value._id) {
      return String(value._id);
    }
    if (typeof value.toString === "function") {
      const asString = String(value.toString());
      return asString && asString !== "[object Object]" ? asString : null;
    }
  }

  return null;
};

const getConversationMemberIds = (conversation) => {
  const members = Array.isArray(conversation?.members) ? conversation.members : [];
  return Array.from(
    new Set(
      members
        .map((member) => toIdString(member))
        .filter(Boolean)
    )
  );
};

const hasConversationAccess = (conversation, userId) => {
  const normalizedUserId = toIdString(userId);
  if (!normalizedUserId) return false;
  return getConversationMemberIds(conversation).includes(normalizedUserId);
};

const canExchangeInConversation = (conversation, senderId, receiverId) => {
  const normalizedSenderId = toIdString(senderId);
  const normalizedReceiverId = toIdString(receiverId);

  if (!normalizedSenderId || !normalizedReceiverId) return false;
  if (normalizedSenderId === normalizedReceiverId) return false;

  const memberIds = getConversationMemberIds(conversation);
  return (
    memberIds.includes(normalizedSenderId) &&
    memberIds.includes(normalizedReceiverId)
  );
};

module.exports = {
  toIdString,
  getConversationMemberIds,
  hasConversationAccess,
  canExchangeInConversation,
};