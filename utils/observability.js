const MAX_RECENT_EVENTS = 200;

const state = {
  startedAt: new Date().toISOString(),
  api: {
    totalRequests: 0,
    totalErrors: 0,
    routes: new Map(),
  },
  socket: {
    totalConnections: 0,
    totalDisconnections: 0,
    activeConnections: 0,
    disconnectReasons: new Map(),
  },
  client: {
    totalEvents: 0,
    bySource: new Map(),
    recentEvents: [],
  },
  backend: {
    uncaughtExceptionCount: 0,
    unhandledRejectionCount: 0,
    recentEvents: [],
  },
};

let processHandlersInstalled = false;

const normalizeRoutePath = (path = "") => {
  const withoutQuery = String(path).split("?")[0];
  return withoutQuery
    .replace(/\/[0-9a-fA-F]{24}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-fA-F-]{36}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9]+(?=\/|$)/g, "/:num");
};

const clampDuration = (durationMs) => {
  if (!Number.isFinite(durationMs) || durationMs < 0) return 0;
  return Math.round(durationMs);
};

const pushRecent = (target, payload) => {
  target.push(payload);
  if (target.length > MAX_RECENT_EVENTS) {
    target.splice(0, target.length - MAX_RECENT_EVENTS);
  }
};

const buildRouteKey = ({ method, path }) => {
  const normalizedMethod = String(method || "GET").toUpperCase();
  return `${normalizedMethod} ${normalizeRoutePath(path)}`;
};

const requestMetricsMiddleware = (req, res, next) => {
  const startedAt = process.hrtime.bigint();

  res.on("finish", () => {
    const endedAt = process.hrtime.bigint();
    const durationMs = clampDuration(Number(endedAt - startedAt) / 1_000_000);

    const method = req.method;
    const path = req.originalUrl || req.url || "";
    const statusCode = Number(res.statusCode || 0);
    const isError = statusCode >= 400;
    const routeKey = buildRouteKey({ method, path });

    state.api.totalRequests += 1;
    if (isError) {
      state.api.totalErrors += 1;
    }

    const routeStats = state.api.routes.get(routeKey) || {
      totalRequests: 0,
      totalErrors: 0,
      totalDurationMs: 0,
      lastStatusCode: 0,
      lastSeenAt: null,
    };

    routeStats.totalRequests += 1;
    routeStats.totalDurationMs += durationMs;
    routeStats.lastStatusCode = statusCode;
    routeStats.lastSeenAt = new Date().toISOString();
    if (isError) {
      routeStats.totalErrors += 1;
    }

    state.api.routes.set(routeKey, routeStats);

    if (state.api.routes.size > 400) {
      const entries = Array.from(state.api.routes.entries())
        .sort((a, b) => {
          const aSeen = Date.parse(a[1].lastSeenAt || 0) || 0;
          const bSeen = Date.parse(b[1].lastSeenAt || 0) || 0;
          return bSeen - aSeen;
        })
        .slice(0, 300);
      state.api.routes = new Map(entries);
    }
  });

  next();
};

const recordSocketConnection = ({ userId, socketId }) => {
  state.socket.totalConnections += 1;
  state.socket.activeConnections += 1;

  pushRecent(state.backend.recentEvents, {
    kind: "socket_connect",
    userId: userId ? String(userId) : null,
    socketId: socketId ? String(socketId) : null,
    at: new Date().toISOString(),
  });
};

const recordSocketDisconnection = ({ userId, socketId, reason }) => {
  state.socket.totalDisconnections += 1;
  state.socket.activeConnections = Math.max(0, state.socket.activeConnections - 1);

  const normalizedReason = String(reason || "unknown");
  const currentReasonCount = state.socket.disconnectReasons.get(normalizedReason) || 0;
  state.socket.disconnectReasons.set(normalizedReason, currentReasonCount + 1);

  pushRecent(state.backend.recentEvents, {
    kind: "socket_disconnect",
    userId: userId ? String(userId) : null,
    socketId: socketId ? String(socketId) : null,
    reason: normalizedReason,
    at: new Date().toISOString(),
  });
};

const sanitizeString = (value, maxLength = 500) => {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
};

const recordClientEvent = ({
  source,
  category,
  level,
  message,
  route,
  metadata,
  userId,
  ip,
}) => {
  const normalizedSource = sanitizeString(source || "unknown", 30) || "unknown";
  const normalizedCategory = sanitizeString(category || "custom", 40) || "custom";
  const normalizedLevel = sanitizeString(level || "error", 20) || "error";

  const event = {
    source: normalizedSource,
    category: normalizedCategory,
    level: normalizedLevel,
    message: sanitizeString(message, 600),
    route: sanitizeString(route, 200),
    userId: userId ? String(userId) : null,
    ip: sanitizeString(ip, 80),
    metadata: metadata && typeof metadata === "object" ? metadata : {},
    at: new Date().toISOString(),
  };

  state.client.totalEvents += 1;
  state.client.bySource.set(
    normalizedSource,
    (state.client.bySource.get(normalizedSource) || 0) + 1
  );
  pushRecent(state.client.recentEvents, event);

  return event;
};

const installProcessLevelHandlers = () => {
  if (processHandlersInstalled) return;
  processHandlersInstalled = true;

  process.on("uncaughtExceptionMonitor", (error, origin) => {
    state.backend.uncaughtExceptionCount += 1;
    pushRecent(state.backend.recentEvents, {
      kind: "uncaught_exception",
      origin: sanitizeString(origin, 60),
      message: sanitizeString(error?.message || String(error), 600),
      stack: sanitizeString(error?.stack || "", 2000),
      at: new Date().toISOString(),
    });
  });

  process.on("unhandledRejection", (reason) => {
    state.backend.unhandledRejectionCount += 1;
    const message = reason instanceof Error
      ? reason.message
      : typeof reason === "string"
        ? reason
        : JSON.stringify(reason);

    pushRecent(state.backend.recentEvents, {
      kind: "unhandled_rejection",
      message: sanitizeString(message, 600),
      stack: sanitizeString(reason?.stack || "", 2000),
      at: new Date().toISOString(),
    });
  });
};

const toPercent = (part, total) => {
  if (!total) return 0;
  return Number(((part / total) * 100).toFixed(2));
};

const buildRouteSummary = () => Array.from(state.api.routes.entries())
  .map(([routeKey, routeStats]) => ({
    routeKey,
    totalRequests: routeStats.totalRequests,
    totalErrors: routeStats.totalErrors,
    errorRatePercent: toPercent(routeStats.totalErrors, routeStats.totalRequests),
    avgDurationMs: routeStats.totalRequests
      ? Math.round(routeStats.totalDurationMs / routeStats.totalRequests)
      : 0,
    lastStatusCode: routeStats.lastStatusCode,
    lastSeenAt: routeStats.lastSeenAt,
  }))
  .sort((a, b) => b.totalRequests - a.totalRequests)
  .slice(0, 50);

const getObservabilitySummary = () => {
  const apiTotal = state.api.totalRequests;
  const apiErrors = state.api.totalErrors;
  const socketConnections = state.socket.totalConnections;
  const socketDisconnections = state.socket.totalDisconnections;

  return {
    generatedAt: new Date().toISOString(),
    startedAt: state.startedAt,
    api: {
      totalRequests: apiTotal,
      totalErrors: apiErrors,
      errorRatePercent: toPercent(apiErrors, apiTotal),
      routes: buildRouteSummary(),
    },
    socket: {
      activeConnections: state.socket.activeConnections,
      totalConnections: socketConnections,
      totalDisconnections: socketDisconnections,
      disconnectRatePercent: toPercent(socketDisconnections, socketConnections),
      disconnectReasons: Object.fromEntries(state.socket.disconnectReasons.entries()),
    },
    client: {
      totalEvents: state.client.totalEvents,
      bySource: Object.fromEntries(state.client.bySource.entries()),
      recentEvents: [...state.client.recentEvents].slice(-50).reverse(),
    },
    backend: {
      uncaughtExceptionCount: state.backend.uncaughtExceptionCount,
      unhandledRejectionCount: state.backend.unhandledRejectionCount,
      recentEvents: [...state.backend.recentEvents].slice(-50).reverse(),
    },
  };
};

module.exports = {
  requestMetricsMiddleware,
  recordSocketConnection,
  recordSocketDisconnection,
  recordClientEvent,
  installProcessLevelHandlers,
  getObservabilitySummary,
};
