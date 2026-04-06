const mongoose = require('mongoose');
const User = require('../models/User');

const POST_VISIBILITY = Object.freeze({
  PUBLIC: 'public',
  CLOSE_FRIENDS: 'close_friends',
});

const normalizePostVisibility = (value) => (
  value === POST_VISIBILITY.CLOSE_FRIENDS
    ? POST_VISIBILITY.CLOSE_FRIENDS
    : POST_VISIBILITY.PUBLIC
);

const resolveOwnerId = (postDoc) => {
  const rawOwner = postDoc?.userId?._id || postDoc?.userId || postDoc?.user?._id || postDoc?.user;
  if (!rawOwner) return null;
  return rawOwner.toString();
};

const toObjectId = (value) => {
  if (!value) return null;
  return mongoose.Types.ObjectId.isValid(value)
    ? new mongoose.Types.ObjectId(value)
    : null;
};

const toMatchIdValue = (value) => toObjectId(value) || value;

const toMatchIdList = (ids = []) => {
  const seen = new Set();
  const matchValues = [];

  ids.forEach((id) => {
    if (!id) return;

    const normalized = id.toString();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);

    matchValues.push(toMatchIdValue(normalized));
  });

  return matchValues;
};

const buildViewerVisibilityContext = async (viewerId) => {
  const normalizedViewerId = viewerId ? viewerId.toString() : null;

  if (!normalizedViewerId) {
    return {
      viewerId: null,
      allowedCloseFriendOwnerSet: new Set(),
      mutedOwnerSet: new Set(),
    };
  }

  const [viewerDoc, closeFriendOwners] = await Promise.all([
    User.findById(normalizedViewerId).select('mutedUsers'),
    User.find({ closeFriends: normalizedViewerId }).select('_id'),
  ]);

  return {
    viewerId: normalizedViewerId,
    allowedCloseFriendOwnerSet: new Set(
      closeFriendOwners.map((owner) => owner._id.toString())
    ),
    mutedOwnerSet: new Set(
      (viewerDoc?.mutedUsers || [])
        .map((ownerId) => ownerId?.toString?.() || String(ownerId || ''))
        .filter(Boolean)
    ),
  };
};

const buildVisibilityQueryForViewer = (viewerContext) => {
  const query = {
    $or: [
      { visibility: { $ne: POST_VISIBILITY.CLOSE_FRIENDS } },
    ],
  };

  if (!viewerContext?.viewerId) {
    return query;
  }

  query.$or.push({ userId: toMatchIdValue(viewerContext.viewerId) });

  const allowedOwnerIds = Array.from(viewerContext.allowedCloseFriendOwnerSet || []);
  const allowedOwnerMatchIds = toMatchIdList(allowedOwnerIds);
  if (allowedOwnerMatchIds.length > 0) {
    query.$or.push({
      visibility: POST_VISIBILITY.CLOSE_FRIENDS,
      userId: { $in: allowedOwnerMatchIds },
    });
  }

  const mutedOwnerIds = Array.from(viewerContext.mutedOwnerSet || [])
    .filter((ownerId) => ownerId && ownerId !== viewerContext.viewerId);
  const mutedOwnerMatchIds = toMatchIdList(mutedOwnerIds);
  if (mutedOwnerMatchIds.length > 0) {
    query.$and = [
      { userId: { $nin: mutedOwnerMatchIds } },
    ];
  }

  return query;
};

const canViewerSeePost = (postDoc, viewerContext) => {
  if (!postDoc) return false;

  const ownerId = resolveOwnerId(postDoc);
  if (!ownerId) return false;

  const viewerId = viewerContext?.viewerId || null;
  if (viewerId && ownerId === viewerId) {
    return true;
  }

  if (viewerContext?.mutedOwnerSet?.has(ownerId)) {
    return false;
  }

  const visibility = normalizePostVisibility(postDoc.visibility);
  if (visibility === POST_VISIBILITY.CLOSE_FRIENDS) {
    return Boolean(viewerContext?.allowedCloseFriendOwnerSet?.has(ownerId));
  }

  return true;
};

module.exports = {
  POST_VISIBILITY,
  normalizePostVisibility,
  buildViewerVisibilityContext,
  buildVisibilityQueryForViewer,
  canViewerSeePost,
};
