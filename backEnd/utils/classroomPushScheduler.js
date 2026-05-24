const { google } = require('googleapis');
const User = require('../models/User');
const { decrypt, encrypt } = require('./crypto');
const { sendPushToUser } = require('./pushNotification');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 90 * 1000;
const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 30;
const MAX_COURSE_COUNT = 30;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const CLASSROOM_PUSH_ENABLED = String(process.env.CLASSROOM_PUSH_ENABLED || 'true')
  .trim()
  .toLowerCase() !== 'false';
const CLASSROOM_PUSH_INTERVAL_MS = parsePositiveInt(
  process.env.CLASSROOM_PUSH_INTERVAL_MS,
  DEFAULT_INTERVAL_MS
);
const CLASSROOM_PUSH_INITIAL_DELAY_MS = parsePositiveInt(
  process.env.CLASSROOM_PUSH_INITIAL_DELAY_MS,
  DEFAULT_INITIAL_DELAY_MS
);
const CLASSROOM_PUSH_PAGE_SIZE = Math.min(
  parsePositiveInt(process.env.CLASSROOM_PUSH_PAGE_SIZE, DEFAULT_PAGE_SIZE),
  MAX_PAGE_SIZE
);
const CLASSROOM_PUSH_MAX_COURSES = parsePositiveInt(
  process.env.CLASSROOM_PUSH_MAX_COURSES,
  MAX_COURSE_COUNT
);

let schedulerStarted = false;
let schedulerTimer = null;
let schedulerInterval = null;
let cycleInProgress = false;

const parseDateMs = (value) => {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
};

const shortenText = (value, max = 64) => {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 3)}...`;
};

const resolveAnnouncementTitle = (item) => {
  const text = shortenText(item?.text, 64);
  return text || '新しいお知らせ';
};

const resolveCourseworkTitle = (item) => {
  const title = shortenText(item?.title, 64);
  if (title) return title;
  const description = shortenText(item?.description, 64);
  return description || '新しい課題';
};

const resolveMaterialTitle = (item) => {
  const title = shortenText(item?.title, 64);
  if (title) return title;
  const description = shortenText(item?.description, 64);
  return description || '新しい教材';
};

const buildItemKey = ({ type, courseId, itemId }) => `${type}:${courseId}:${itemId}`;

const ensureGoogleClassroomClient = async (user) => {
  const encryptedRefreshToken = user?.refreshToken;
  if (!encryptedRefreshToken) {
    return null;
  }

  let refreshToken = null;
  try {
    refreshToken = decrypt(encryptedRefreshToken);
  } catch (err) {
    console.warn('[ClassroomPush] Failed to decrypt refreshToken', {
      userId: user?._id ? String(user._id) : null,
      error: err?.message || String(err),
    });
    return null;
  }

  if (!refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  oauth2Client.on('tokens', async (tokens) => {
    if (!tokens?.refresh_token) return;
    try {
      await User.findByIdAndUpdate(user._id, {
        $set: { refreshToken: encrypt(tokens.refresh_token) },
      });
    } catch (err) {
      console.error('[ClassroomPush] Failed to persist refreshed token:', err);
    }
  });

  return google.classroom({ version: 'v1', auth: oauth2Client });
};

const fetchActiveCourses = async (classroom) => {
  let pageToken;
  const courses = [];

  do {
    const res = await classroom.courses.list({
      courseStates: ['ACTIVE'],
      pageSize: 100,
      pageToken,
    });

    courses.push(...(res.data.courses || []));
    pageToken = res.data.nextPageToken;
  } while (pageToken);

  if (courses.length <= CLASSROOM_PUSH_MAX_COURSES) {
    return courses;
  }

  return courses.slice(0, CLASSROOM_PUSH_MAX_COURSES);
};

const fetchCourseItems = async (classroom, course) => {
  const courseId = String(course?.id || '');
  if (!courseId) return [];

  const [announcementsRes, courseWorkRes, materialsRes] = await Promise.all([
    classroom.courses.announcements
      .list({ courseId, pageSize: CLASSROOM_PUSH_PAGE_SIZE })
      .catch(() => ({ data: { announcements: [] } })),
    classroom.courses.courseWork
      .list({ courseId, pageSize: CLASSROOM_PUSH_PAGE_SIZE })
      .catch(() => ({ data: { courseWork: [] } })),
    classroom.courses.courseWorkMaterials
      .list({ courseId, pageSize: CLASSROOM_PUSH_PAGE_SIZE })
      .catch(() => ({ data: { courseWorkMaterial: [] } })),
  ]);

  const courseName = String(course?.name || '').trim() || 'クラスルーム';

  const announcements = (announcementsRes?.data?.announcements || [])
    .map((item) => {
      const itemId = String(item?.id || '');
      if (!itemId) return null;
      const timestamp = parseDateMs(item?.updateTime || item?.creationTime);
      if (!timestamp) return null;

      return {
        key: buildItemKey({ type: 'announcement', courseId, itemId }),
        type: 'announcement',
        courseId,
        courseName,
        itemId,
        title: resolveAnnouncementTitle(item),
        timestamp,
      };
    })
    .filter(Boolean);

  const courseWorks = (courseWorkRes?.data?.courseWork || [])
    .map((item) => {
      const itemId = String(item?.id || '');
      if (!itemId) return null;
      const timestamp = parseDateMs(item?.updateTime || item?.creationTime);
      if (!timestamp) return null;

      return {
        key: buildItemKey({ type: 'coursework', courseId, itemId }),
        type: 'coursework',
        courseId,
        courseName,
        itemId,
        title: resolveCourseworkTitle(item),
        timestamp,
      };
    })
    .filter(Boolean);

  const materials = (materialsRes?.data?.courseWorkMaterial || [])
    .map((item) => {
      const itemId = String(item?.id || '');
      if (!itemId) return null;
      const timestamp = parseDateMs(item?.updateTime || item?.creationTime);
      if (!timestamp) return null;

      return {
        key: buildItemKey({ type: 'material', courseId, itemId }),
        type: 'material',
        courseId,
        courseName,
        itemId,
        title: resolveMaterialTitle(item),
        timestamp,
      };
    })
    .filter(Boolean);

  return [...announcements, ...courseWorks, ...materials];
};

const buildPushPayload = (items) => {
  const sortedItems = [...items].sort((a, b) => b.timestamp - a.timestamp);
  const latest = sortedItems[0];
  const count = sortedItems.length;

  const title = count > 1
    ? `クラスルームに新着${count}件`
    : 'クラスルームに新着があります';

  const bodyPrefix = latest?.courseName ? `${latest.courseName}: ` : '';
  const body = count > 1
    ? `${bodyPrefix}${latest?.title || '新しい投稿'} など`
    : `${bodyPrefix}${latest?.title || '新しい投稿'}`;

  return {
    title,
    body,
    data: {
      type: 'classroom_post',
      classroomItemType: latest?.type || 'announcement',
      classroomItemId: latest?.itemId || '',
      courseId: latest?.courseId || '',
      count,
    },
  };
};

const upsertCursor = async (userId, cursorMs) => {
  if (!cursorMs || !Number.isFinite(cursorMs)) return;
  await User.findByIdAndUpdate(userId, {
    $set: { classroomNotificationCursorAt: new Date(cursorMs) },
  });
};

const processUser = async (user) => {
  const userId = user?._id ? String(user._id) : null;
  if (!userId) return { skipped: 'invalid_user' };

  if (user?.notificationPreferences?.newPost === false) {
    return { skipped: 'notifications_disabled' };
  }

  const classroom = await ensureGoogleClassroomClient(user);
  if (!classroom) {
    return { skipped: 'missing_classroom_client' };
  }

  const courses = await fetchActiveCourses(classroom);

  if (!courses.length) {
    const existingCursorMs = parseDateMs(user.classroomNotificationCursorAt);
    if (!existingCursorMs) {
      await upsertCursor(userId, Date.now());
      return { bootstrapped: true, courses: 0 };
    }
    return { courses: 0 };
  }

  const itemBatches = await Promise.allSettled(
    courses.map((course) => fetchCourseItems(classroom, course))
  );

  const allItems = itemBatches
    .filter((result) => result.status === 'fulfilled')
    .flatMap((result) => result.value || []);

  if (!allItems.length) {
    const existingCursorMs = parseDateMs(user.classroomNotificationCursorAt);
    if (!existingCursorMs) {
      await upsertCursor(userId, Date.now());
      return { bootstrapped: true, courses: courses.length, itemCount: 0 };
    }
    return { courses: courses.length, itemCount: 0 };
  }

  const dedupedMap = new Map();
  allItems.forEach((item) => {
    const existing = dedupedMap.get(item.key);
    if (!existing || existing.timestamp < item.timestamp) {
      dedupedMap.set(item.key, item);
    }
  });

  const dedupedItems = Array.from(dedupedMap.values()).sort((a, b) => b.timestamp - a.timestamp);
  const latestSeenTs = dedupedItems[0]?.timestamp || Date.now();
  const cursorMs = parseDateMs(user.classroomNotificationCursorAt);

  if (!cursorMs) {
    await upsertCursor(userId, latestSeenTs);
    return { bootstrapped: true, courses: courses.length, itemCount: dedupedItems.length };
  }

  const newItems = dedupedItems.filter((item) => item.timestamp > cursorMs);
  if (!newItems.length) {
    return { courses: courses.length, itemCount: dedupedItems.length, newItems: 0 };
  }

  const payload = buildPushPayload(newItems);
  await sendPushToUser({
    receiverId: user._id,
    title: payload.title,
    body: payload.body,
    data: payload.data,
    forceImmediate: true,
  });

  const newCursorTs = Math.max(cursorMs, ...newItems.map((item) => item.timestamp));
  await upsertCursor(userId, newCursorTs);

  return {
    courses: courses.length,
    itemCount: dedupedItems.length,
    newItems: newItems.length,
    latestType: newItems[0]?.type || 'announcement',
  };
};

const runClassroomPushCycle = async () => {
  if (!CLASSROOM_PUSH_ENABLED) {
    return;
  }

  if (cycleInProgress) {
    console.log('[ClassroomPush] Skip cycle: previous cycle still running');
    return;
  }

  cycleInProgress = true;

  const startedAt = Date.now();
  let processed = 0;
  let pushed = 0;

  try {
    const users = await User.find({
      refreshToken: { $exists: true, $ne: null },
      fcmToken: { $exists: true, $ne: null },
      'notificationPreferences.newPost': { $ne: false },
    })
      .select('_id refreshToken fcmToken notificationPreferences classroomNotificationCursorAt')
      .lean();

    for (const user of users) {
      try {
        const result = await processUser(user);
        processed += 1;
        if (result?.newItems > 0) {
          pushed += 1;
        }
      } catch (userErr) {
        console.error('[ClassroomPush] User cycle failed:', {
          userId: user?._id ? String(user._id) : null,
          error: userErr?.message || String(userErr),
        });
      }
    }

    console.log(
      `[ClassroomPush] Cycle completed users=${processed} pushed=${pushed} elapsedMs=${Date.now() - startedAt}`
    );
  } catch (err) {
    console.error('[ClassroomPush] Cycle error:', err);
  } finally {
    cycleInProgress = false;
  }
};

const startClassroomPushScheduler = () => {
  if (schedulerStarted) return;

  if (!CLASSROOM_PUSH_ENABLED) {
    console.log('[ClassroomPush] Scheduler disabled by CLASSROOM_PUSH_ENABLED=false');
    return;
  }

  schedulerStarted = true;

  schedulerTimer = setTimeout(() => {
    runClassroomPushCycle().catch((err) => {
      console.error('[ClassroomPush] Initial cycle error:', err);
    });

    schedulerInterval = setInterval(() => {
      runClassroomPushCycle().catch((err) => {
        console.error('[ClassroomPush] Interval cycle error:', err);
      });
    }, CLASSROOM_PUSH_INTERVAL_MS);
  }, CLASSROOM_PUSH_INITIAL_DELAY_MS);

  console.log(
    `[ClassroomPush] Scheduler started intervalMs=${CLASSROOM_PUSH_INTERVAL_MS} initialDelayMs=${CLASSROOM_PUSH_INITIAL_DELAY_MS} pageSize=${CLASSROOM_PUSH_PAGE_SIZE}`
  );
};

module.exports = {
  startClassroomPushScheduler,
  runClassroomPushCycle,
};
