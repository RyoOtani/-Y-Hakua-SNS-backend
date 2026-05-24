const router = require('express').Router();
const { google } = require('googleapis');
const User = require('../models/User');
const { authenticate } = require('../middleware/auth');
const { decrypt, encrypt } = require('../utils/crypto');

const requireJwt = authenticate;
const MAX_PAGE_SIZE = 100;

const parsePageSize = (value, fallback = 30) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, MAX_PAGE_SIZE);
};

const parseBooleanQuery = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const ensureGoogleClassroomClient = async (userId) => {
  const user = await User.findById(userId).select('refreshToken email');
  if (!user || !user.refreshToken) {
    const error = new Error('Google認証が必要です。再ログインしてください。');
    error.statusCode = 401;
    throw error;
  }

  const refreshToken = decrypt(user.refreshToken);
  if (!refreshToken) {
    const error = new Error('Google認証が必要です。再ログインしてください。');
    error.statusCode = 401;
    throw error;
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback'
  );

  oauth2Client.setCredentials({ refresh_token: refreshToken });

  oauth2Client.on('tokens', async (tokens) => {
    if (!tokens?.refresh_token) return;
    await User.findByIdAndUpdate(userId, { refreshToken: encrypt(tokens.refresh_token) });
  });

  return google.classroom({ version: 'v1', auth: oauth2Client });
};

const toDateValue = (value) => {
  if (!value) return 0;
  const ts = new Date(value).getTime();
  return Number.isFinite(ts) ? ts : 0;
};

const toDueAtIso = (dueDate, dueTime) => {
  if (!dueDate || !dueDate.year || !dueDate.month || !dueDate.day) return null;
  const hours = Number.isFinite(dueTime?.hours) ? dueTime.hours : 23;
  const minutes = Number.isFinite(dueTime?.minutes) ? dueTime.minutes : 59;
  const seconds = Number.isFinite(dueTime?.seconds) ? dueTime.seconds : 0;

  const dueAt = new Date(Date.UTC(
    dueDate.year,
    dueDate.month - 1,
    dueDate.day,
    hours,
    minutes,
    seconds
  ));

  return Number.isFinite(dueAt.getTime()) ? dueAt.toISOString() : null;
};

const mapMaterialLinks = (materials = []) => {
  if (!Array.isArray(materials)) return [];

  const links = [];
  materials.forEach((material) => {
    if (material?.link?.url) {
      links.push({
        type: 'link',
        title: material.link.title || material.link.url,
        url: material.link.url,
      });
    }

    if (material?.youtubeVideo?.alternateLink) {
      links.push({
        type: 'youtube',
        title: material.youtubeVideo.title || material.youtubeVideo.alternateLink,
        url: material.youtubeVideo.alternateLink,
        thumbnailUrl: material.youtubeVideo.thumbnailUrl || null,
      });
    }

    if (material?.driveFile?.driveFile?.alternateLink) {
      links.push({
        type: 'drive_file',
        title: material.driveFile.driveFile.title || material.driveFile.driveFile.alternateLink,
        url: material.driveFile.driveFile.alternateLink,
      });
    }

    if (material?.driveFolder?.alternateLink) {
      links.push({
        type: 'drive_folder',
        title: material.driveFolder.title || material.driveFolder.alternateLink,
        url: material.driveFolder.alternateLink,
      });
    }

    if (material?.form?.formUrl) {
      links.push({
        type: 'form',
        title: material.form.title || material.form.formUrl,
        url: material.form.formUrl,
      });
    }
  });

  return links;
};

const normalizeCourse = (course) => ({
  id: course.id,
  name: course.name,
  section: course.section || '',
  description: course.description || '',
  descriptionHeading: course.descriptionHeading || '',
  room: course.room || '',
  courseState: course.courseState,
  enrollmentCode: course.enrollmentCode || '',
  ownerId: course.ownerId || null,
  alternateLink: course.alternateLink || '',
  updateTime: course.updateTime || null,
});

const normalizeAnnouncement = (item, course) => ({
  id: item.id,
  type: 'announcement',
  courseId: course.id,
  courseName: course.name,
  courseLink: course.alternateLink,
  text: item.text || '',
  state: item.state || '',
  alternateLink: item.alternateLink || '',
  creatorUserId: item.creatorUserId || null,
  creationTime: item.creationTime || null,
  updateTime: item.updateTime || null,
  materials: mapMaterialLinks(item.materials),
});

const normalizeCourseWork = (item, course, topicName = '', submissionState = null) => ({
  id: item.id,
  type: 'coursework',
  courseId: course.id,
  courseName: course.name,
  courseLink: course.alternateLink,
  title: item.title || '',
  description: item.description || '',
  state: item.state || '',
  workType: item.workType || '',
  maxPoints: Number.isFinite(item.maxPoints) ? item.maxPoints : null,
  topicId: item.topicId || null,
  topicName: topicName || '',
  dueDate: item.dueDate || null,
  dueTime: item.dueTime || null,
  dueAt: toDueAtIso(item.dueDate, item.dueTime),
  alternateLink: item.alternateLink || '',
  creationTime: item.creationTime || null,
  updateTime: item.updateTime || null,
  submissionState,
  materials: mapMaterialLinks(item.materials),
});

const normalizeMaterial = (item, course, topicName = '') => ({
  id: item.id,
  type: 'material',
  courseId: course.id,
  courseName: course.name,
  courseLink: course.alternateLink,
  title: item.title || '',
  description: item.description || '',
  state: item.state || '',
  topicId: item.topicId || null,
  topicName: topicName || '',
  alternateLink: item.alternateLink || '',
  creationTime: item.creationTime || null,
  updateTime: item.updateTime || null,
  materials: mapMaterialLinks(item.materials),
});

const buildTopicMap = (topics = []) => {
  const map = new Map();
  topics.forEach((topic) => {
    if (topic?.topicId) {
      map.set(topic.topicId, topic.name || 'トピックなし');
    }
  });
  return map;
};

const withClassroomClient = async (req, res, handler) => {
  try {
    const classroom = await ensureGoogleClassroomClient(req.user.id);
    await handler(classroom);
  } catch (error) {
    const statusCode = error.statusCode || error.response?.status || 500;
    const message =
      statusCode === 401
        ? 'Googleの認証に失敗しました。アカウント連携を確認し、再ログインしてください。'
        : error.message || 'Classroomデータの取得中にエラーが発生しました。';

    console.error('[Classroom] Request failed:', {
      path: req.originalUrl,
      userId: req.user?.id || null,
      statusCode,
      message: error.message,
      apiError: error.response?.data || null,
    });

    return res.status(statusCode).json({ message });
  }
};

router.get('/courses', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 50);
    let pageToken;
    const courses = [];

    do {
      const response = await classroom.courses.list({
        courseStates: ['ACTIVE'],
        pageSize,
        pageToken,
      });
      courses.push(...(response.data.courses || []));
      pageToken = response.data.nextPageToken;
    } while (pageToken);

    const normalizedCourses = courses
      .map(normalizeCourse)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));

    return res.json(normalizedCourses);
  });
});

router.get('/courses/:courseId/announcements', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 30);
    const { courseId } = req.params;

    const [courseRes, announceRes] = await Promise.all([
      classroom.courses.get({ id: courseId }),
      classroom.courses.announcements.list({ courseId, pageSize }),
    ]);

    const course = normalizeCourse(courseRes.data);
    const announcements = (announceRes.data.announcements || [])
      .map((item) => normalizeAnnouncement(item, course))
      .sort((a, b) => toDateValue(b.updateTime || b.creationTime) - toDateValue(a.updateTime || a.creationTime));

    return res.json(announcements);
  });
});

router.get('/courses/:courseId/coursework', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 50);
    const includeSubmissions = parseBooleanQuery(req.query.includeSubmissions, true);
    const { courseId } = req.params;

    const [courseRes, topicsRes, workRes] = await Promise.all([
      classroom.courses.get({ id: courseId }),
      classroom.courses.topics.list({ courseId, pageSize: 100 }).catch(() => ({ data: { topic: [] } })),
      classroom.courses.courseWork.list({ courseId, pageSize }),
    ]);

    const course = normalizeCourse(courseRes.data);
    const topicMap = buildTopicMap(topicsRes.data.topic || []);
    const works = workRes.data.courseWork || [];

    const normalizedWork = await Promise.all(works.map(async (item) => {
      let submissionState = null;

      if (includeSubmissions) {
        try {
          const subRes = await classroom.courses.courseWork.studentSubmissions.list({
            courseId,
            courseWorkId: item.id,
            userId: 'me',
            pageSize: 1,
          });

          submissionState = subRes.data.studentSubmissions?.[0]?.state || null;
        } catch (_) {
          submissionState = null;
        }
      }

      return normalizeCourseWork(item, course, topicMap.get(item.topicId || '') || '', submissionState);
    }));

    normalizedWork.sort((a, b) => toDateValue(b.updateTime || b.creationTime) - toDateValue(a.updateTime || a.creationTime));
    return res.json(normalizedWork);
  });
});

router.get('/courses/:courseId/materials', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 50);
    const { courseId } = req.params;

    const [courseRes, topicsRes, materialRes] = await Promise.all([
      classroom.courses.get({ id: courseId }),
      classroom.courses.topics.list({ courseId, pageSize: 100 }).catch(() => ({ data: { topic: [] } })),
      classroom.courses.courseWorkMaterials.list({ courseId, pageSize }),
    ]);

    const course = normalizeCourse(courseRes.data);
    const topicMap = buildTopicMap(topicsRes.data.topic || []);
    const materials = (materialRes.data.courseWorkMaterial || [])
      .map((item) => normalizeMaterial(item, course, topicMap.get(item.topicId || '') || ''))
      .sort((a, b) => toDateValue(b.updateTime || b.creationTime) - toDateValue(a.updateTime || a.creationTime));

    return res.json(materials);
  });
});

router.get('/courses/:courseId/stream', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 30);
    const { courseId } = req.params;

    const [courseRes, topicsRes, announceRes, workRes, materialRes] = await Promise.all([
      classroom.courses.get({ id: courseId }),
      classroom.courses.topics.list({ courseId, pageSize: 100 }).catch(() => ({ data: { topic: [] } })),
      classroom.courses.announcements.list({ courseId, pageSize }).catch(() => ({ data: { announcements: [] } })),
      classroom.courses.courseWork.list({ courseId, pageSize }).catch(() => ({ data: { courseWork: [] } })),
      classroom.courses.courseWorkMaterials.list({ courseId, pageSize }).catch(() => ({ data: { courseWorkMaterial: [] } })),
    ]);

    const course = normalizeCourse(courseRes.data);
    const topicMap = buildTopicMap(topicsRes.data.topic || []);

    const announcements = (announceRes.data.announcements || []).map((item) => normalizeAnnouncement(item, course));
    const works = (workRes.data.courseWork || []).map((item) =>
      normalizeCourseWork(item, course, topicMap.get(item.topicId || '') || '', null)
    );
    const materials = (materialRes.data.courseWorkMaterial || []).map((item) =>
      normalizeMaterial(item, course, topicMap.get(item.topicId || '') || '')
    );

    const streamItems = [...announcements, ...works, ...materials].sort((a, b) => {
      const aDate = toDateValue(a.updateTime || a.creationTime || a.dueAt);
      const bDate = toDateValue(b.updateTime || b.creationTime || b.dueAt);
      return bDate - aDate;
    });

    return res.json(streamItems);
  });
});

router.get('/announcements', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 10);
    const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'], pageSize: 100 });
    const courses = (coursesRes.data.courses || []).map(normalizeCourse);

    const streamByCourse = await Promise.all(courses.map(async (course) => {
      const [annRes, workRes, matRes] = await Promise.all([
        classroom.courses.announcements.list({ courseId: course.id, pageSize }).catch(() => ({ data: { announcements: [] } })),
        classroom.courses.courseWork.list({ courseId: course.id, pageSize }).catch(() => ({ data: { courseWork: [] } })),
        classroom.courses.courseWorkMaterials.list({ courseId: course.id, pageSize }).catch(() => ({ data: { courseWorkMaterial: [] } })),
      ]);

      const announcements = (annRes.data.announcements || []).map((item) => normalizeAnnouncement(item, course));
      const courseWorks = (workRes.data.courseWork || []).map((item) => normalizeCourseWork(item, course));
      const materials = (matRes.data.courseWorkMaterial || []).map((item) => normalizeMaterial(item, course));
      return [...announcements, ...courseWorks, ...materials];
    }));

    const allItems = streamByCourse
      .flat()
      .sort((a, b) => toDateValue(b.updateTime || b.creationTime || b.dueAt) - toDateValue(a.updateTime || a.creationTime || a.dueAt));

    return res.json(allItems);
  });
});

router.get('/todo', requireJwt, async (req, res) => {
  return withClassroomClient(req, res, async (classroom) => {
    const pageSize = parsePageSize(req.query.pageSize, 50);

    const coursesRes = await classroom.courses.list({ courseStates: ['ACTIVE'], pageSize: 100 });
    const courses = (coursesRes.data.courses || []).map(normalizeCourse);

    const courseTasks = await Promise.all(courses.map(async (course) => {
      const workRes = await classroom.courses.courseWork.list({ courseId: course.id, pageSize }).catch(() => ({ data: { courseWork: [] } }));
      const works = workRes.data.courseWork || [];

      const normalized = await Promise.all(works.map(async (item) => {
        let submissionState = null;
        try {
          const subRes = await classroom.courses.courseWork.studentSubmissions.list({
            courseId: course.id,
            courseWorkId: item.id,
            userId: 'me',
            pageSize: 1,
          });
          submissionState = subRes.data.studentSubmissions?.[0]?.state || null;
        } catch (_) {
          submissionState = null;
        }

        return normalizeCourseWork(item, course, '', submissionState);
      }));

      return normalized;
    }));

    const now = Date.now();
    const todoItems = courseTasks
      .flat()
      .filter((item) => item.type === 'coursework')
      .map((item) => {
        const dueAtTs = toDateValue(item.dueAt);
        const turnedIn = item.submissionState === 'TURNED_IN' || item.submissionState === 'RETURNED';
        const missing = dueAtTs > 0 && dueAtTs < now && !turnedIn;
        const pending = !turnedIn;

        return {
          ...item,
          turnedIn,
          pending,
          missing,
        };
      })
      .filter((item) => item.pending)
      .sort((a, b) => {
        const aDue = toDateValue(a.dueAt);
        const bDue = toDateValue(b.dueAt);

        if (!aDue && !bDue) {
          return toDateValue(b.updateTime || b.creationTime) - toDateValue(a.updateTime || a.creationTime);
        }
        if (!aDue) return 1;
        if (!bDue) return -1;
        return aDue - bDue;
      });

    return res.json(todoItems);
  });
});

module.exports = router;