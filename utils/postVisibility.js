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

const buildViewerVisibilityContext = async (viewerId) => {
  const normalizedViewerId = viewerId ? viewerId.toString() : null;

  if (!normalizedViewerId) {
    return {
      viewerId: null,
      allowedCloseFriendOwnerSet: new Set(),
    };
  }

  const closeFriendOwners = await User.find({ closeFriends: normalizedViewerId }).select('_id');

  return {
    viewerId: normalizedViewerId,
    allowedCloseFriendOwnerSet: new Set(
      closeFriendOwners.map((owner) => owner._id.toString())
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

  query.$or.push({ userId: viewerContext.viewerId });

  const allowedOwnerIds = Array.from(viewerContext.allowedCloseFriendOwnerSet || []);
  if (allowedOwnerIds.length > 0) {
    query.$or.push({
      visibility: POST_VISIBILITY.CLOSE_FRIENDS,
      userId: { $in: allowedOwnerIds },
    });
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
