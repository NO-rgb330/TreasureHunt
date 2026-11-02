/**
 * TREASURE HUNT APP — Google Apps Script Backend
 * ------------------------------------------------
 * Deploy as Web App (Execute as: Me, Access: Anyone).
 * All API calls are POST with `Content-Type: text/plain` and a JSON body.
 * Tokens are validated server-side. Roles are enforced server-side.
 *
 * Required Script Properties (set in Editor > Project Settings > Script Properties):
 *   SPREADSHEET_ID  – the ID of the Treasure Hunt spreadsheet
 */

/* ============================ CONFIG ============================ */

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || '';

const CONFIG = {
  SESSION_TTL_SECONDS: 60 * 60 * 24,
  SESSION_CACHE_SECONDS: 3600,
  SESSION_CACHE_PREFIX: 'sess:',
  RATE_LIMIT_PER_MINUTE: 240,
  LOGIN_LIMIT_PER_WINDOW: 10,
  LOGIN_WINDOW_SECONDS: 300
};

const SHEETS = {
  STUDENTS: 'Students',
  TEACHERS: 'Teachers',
  CLASSES: 'Classes',
  HUNTS: 'TreasureHunts',
  CHALLENGES: 'Challenges',
  QUIZZES: 'Quizzes',
  QUESTIONS: 'Questions',
  RESULTS: 'QuizResults',
  TRANSACTIONS: 'ScoreTransactions',
  SESSIONS: 'Sessions',
  AUDIT: 'AuditLog',
  SETTINGS: 'Settings'
};

const HEADERS = {
  Students: ['StudentID','DisplayName','Email','PasswordHash','PasswordSalt','ClassID','Status','CreatedAt'],
  Teachers: ['TeacherID','DisplayName','Email','PasswordHash','PasswordSalt','Role','ClassIDs','Status','CreatedAt'],
  Classes: ['ClassID','ClassName','TeacherIDs','CreatedAt'],
  TreasureHunts: ['HuntID','Name','Description','Instructions','CreatedBy','StartDate','EndDate','Status','AssignedClassIDs','Published','CreatedAt'],
  Challenges: ['ChallengeID','HuntID','Name','Description','QRToken','QuizID','FormURL','MaxPoints','PassingPercent','StartDate','EndDate','Status','AssignedClassIDs','OrderIndex','CreatedAt'],
  Quizzes: ['QuizID','Title','Description','TimeLimitMinutes','PassingPercent','Status','CreatedAt'],
  Questions: ['QuestionID','QuizID','Type','Text','OptionsJSON','CorrectIndex','Explanation','Marks','OrderIndex'],
  QuizResults: ['SubmissionID','StudentID','ChallengeID','QuizID','AnswersJSON','Score','MaxScore','Passed','SubmittedAt','GradingStatus'],
  ScoreTransactions: ['TransactionID','StudentID','ChallengeID','PointsAwarded','TransactionTime','Reason','VerificationStatus'],
  Sessions: ['Token','UserID','Role','ExpiresAt','CreatedAt'],
  AuditLog: ['LogID','Timestamp','ActorID','ActorRole','Action','TargetRecord','Description'],
  Settings: ['Key','Value']
};

/* ============================ ENTRY POINTS ============================ */

function doGet(e) {
  return out_({ ok: true, service: 'treasure-hunt-app', time: new Date().toISOString() });
}

function doPost(e) {
  let payload = {};
  try {
    if (e && e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e && e.parameter) {
      payload = e.parameter;
    }
  } catch (err) {
    return out_({ ok: false, error: 'Invalid JSON body' });
  }

  const action = String(payload.action || '');
  if (!action) return out_({ ok: false, error: 'Missing action' });

  // Lightweight rate-limit keyed on token or email
  const key = (payload.token || '') + '|' + (payload.email || '') + '|' + action;
  if (!rateLimit_(key, CONFIG.RATE_LIMIT_PER_MINUTE, 60)) {
    return out_({ ok: false, error: 'Rate limit exceeded. Please wait a moment.' });
  }

  const PUBLIC = ['login'];
  let session = null;
  if (!PUBLIC.includes(action)) {
    session = getSession_(payload.token);
    if (!session) return out_({ ok: false, error: 'Not authenticated', code: 'AUTH_REQUIRED' });
  }

  try {
    const data = route_(action, payload, session);
    return out_({ ok: true, data: data });
  } catch (err) {
    const msg = (err && err.message) ? err.message : 'Server error';
    try {
      if (session) logAudit_(session.userId, session.role, 'ERROR', action, '', msg);
    } catch (e2) {}
    return out_({ ok: false, error: msg });
  }
}

/* ============================ ROUTING ============================ */

function route_(action, payload, session) {
  switch (action) {
    /* ---- auth ---- */
    case 'login': return login_(payload);
    case 'logout': return logout_(payload, session);
    case 'me': return me_(session);

    /* ---- student ---- */
    case 'getStudentDashboard': return getStudentDashboard_(session);
    case 'getTreasureHunts': return getTreasureHunts_(session);
    case 'getHunt': return getHunt_(payload, session);
    case 'getChallengeByToken': return getChallengeByToken_(payload, session);
    case 'getQuizForStudent': return getQuizForStudent_(payload, session);
    case 'submitQuiz': return submitQuiz_(payload, session);
    case 'getLeaderboard': return getLeaderboard_(payload, session);
    case 'getMyProgress': return getMyProgress_(session);
    case 'getMyAchievements': return getMyAchievements_(session);
    case 'getMyProfile': return getMyProfile_(session);
    case 'updateMyProfile': return updateMyProfile_(payload, session);

    /* ---- teacher ---- */
    case 'teacher.getOverview': return teacher_(session, 'teacher', teacherGetOverview_, []);
    case 'teacher.getHunts': return teacher_(session, 'teacher', teacherGetHunts_, []);
    case 'teacher.createHunt': return teacher_(session, 'teacher', teacherCreateHunt_, [payload, session]);
    case 'teacher.updateHunt': return teacher_(session, 'teacher', teacherUpdateHunt_, [payload, session]);
    case 'teacher.deleteHunt': return teacher_(session, 'teacher', teacherDeleteHunt_, [payload, session]);
    case 'teacher.getChallenges': return teacher_(session, 'teacher', teacherGetChallenges_, [payload, session]);
    case 'teacher.createChallenge': return teacher_(session, 'teacher', teacherCreateChallenge_, [payload, session]);
    case 'teacher.updateChallenge': return teacher_(session, 'teacher', teacherUpdateChallenge_, [payload, session]);
    case 'teacher.regenerateToken': return teacher_(session, 'teacher', teacherRegenerateToken_, [payload, session]);
    case 'teacher.disableChallenge': return teacher_(session, 'teacher', teacherDisableChallenge_, [payload, session]);
    case 'teacher.getQuizzes': return teacher_(session, 'teacher', teacherGetQuizzes_, [session]);
    case 'teacher.getQuiz': return teacher_(session, 'teacher', teacherGetQuiz_, [payload, session]);
    case 'teacher.saveQuiz': return teacher_(session, 'teacher', teacherSaveQuiz_, [payload, session]);
    case 'teacher.deleteQuiz': return teacher_(session, 'teacher', teacherDeleteQuiz_, [payload, session]);
    case 'teacher.getStudents': return teacher_(session, 'teacher', teacherGetStudents_, [payload, session]);
    case 'teacher.getStudentReport': return teacher_(session, 'teacher', teacherGetStudentReport_, [payload, session]);
    case 'teacher.getReports': return teacher_(session, 'teacher', teacherGetReports_, [payload, session]);
    case 'teacher.getAudit': return teacher_(session, 'teacher', teacherGetAudit_, [payload, session]);
    case 'teacher.getClasses': return teacher_(session, 'teacher', teacherGetClasses_, []);

    /* ---- admin ---- */
    case 'admin.getUsers': return teacher_(session, 'admin', adminGetUsers_, []);
    case 'admin.createTeacher': return teacher_(session, 'admin', adminCreateTeacher_, [payload, session]);
    case 'admin.createStudent': return teacher_(session, 'admin', adminCreateStudent_, [payload, session]);
    case 'admin.updateUserStatus': return teacher_(session, 'admin', adminUpdateUserStatus_, [payload, session]);
    case 'admin.updateUserClass': return teacher_(session, 'admin', adminUpdateUserClass_, [payload, session]);
    case 'admin.resetPassword': return teacher_(session, 'admin', adminResetPassword_, [payload, session]);
    case 'admin.getClasses': return teacher_(session, 'admin', adminGetClasses_, []);
    case 'admin.createClass': return teacher_(session, 'admin', adminCreateClass_, [payload, session]);
    case 'admin.assignTeacherToClass': return teacher_(session, 'admin', adminAssignTeacherToClass_, [payload, session]);
    case 'admin.getAudit': return teacher_(session, 'admin', adminGetAudit_, [payload, session]);
    case 'admin.getStats': return teacher_(session, 'admin', adminGetStats_, []);

    default:
      throw new Error('Unknown action: ' + action);
  }
}

function teacher_(session, role, fn, args) {
  if (session.role !== role && session.role !== 'admin') throw new Error('Not authorized');
  return fn.apply(null, args || []);
}

/* ============================ LOW-LEVEL HELPERS ============================ */

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function ss_() {
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID is not configured in Script Properties');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function sh_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const h = HEADERS[name];
    if (h) sh.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
  }
  return sh;
}

function readAll_(name) {
  const sh = sh_(name);
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const o = {};
    headers.forEach((h, i) => { o[h] = row[i]; });
    return o;
  });
}

function append_(name, obj) {
  const headers = HEADERS[name];
  const row = headers.map(h => obj[h] !== undefined && obj[h] !== null ? obj[h] : '');
  sh_(name).appendRow(row);
  return obj;
}

function updateById_(name, idField, idVal, updates) {
  const sh = sh_(name);
  const headers = HEADERS[name];
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return false;
  const idCol = headers.indexOf(idField);
  if (idCol < 0) throw new Error('Unknown id field');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(idVal)) {
      Object.keys(updates).forEach(k => {
        const c = headers.indexOf(k);
        if (c >= 0) sh.getRange(r + 1, c + 1).setValue(updates[k]);
      });
      return true;
    }
  }
  return false;
}

function findOne_(name, fn) { return readAll_(name).find(fn) || null; }
function findMany_(name, fn) { return readAll_(name).filter(fn); }

function newId_(prefix) {
  return prefix + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, 16);
}
function nowIso_() { return new Date().toISOString(); }
function truthy_(v) {
  if (v === true || v === 1) return true;
  const s = String(v || '').toLowerCase();
  return s === 'true' || s === 'yes' || s === '1';
}
function splitIds_(v) {
  return String(v || '').split(',').map(x => x.trim()).filter(Boolean);
}
function inRange_(start, end, when) {
  const n = when || new Date();
  if (start && new Date(start).getTime() > n.getTime()) return false;
  if (end && new Date(end).getTime() < n.getTime()) return false;
  return true;
}
function classAllowed_(assigned, classId) {
  const ids = splitIds_(assigned);
  if (!ids.length) return true;
  return ids.includes(String(classId));
}
function parseJSON_(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function sha256Hex_(str) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b => ('0' + (b & 0xFF).toString(16)).slice(-2)).join('');
}
function genSalt_() { return Utilities.getUuid().replace(/-/g, ''); }
function hashPwd_(pwd, salt) { return sha256Hex_(salt + ':' + pwd); }

function rateLimit_(key, max, windowSec) {
  const cache = CacheService.getScriptCache();
  const k = 'rl:' + sha256Hex_(key).slice(0, 24);
  const cur = Number(cache.get(k) || 0);
  if (cur >= max) return false;
  cache.put(k, String(cur + 1), windowSec);
  return true;
}

function logAudit_(actorId, actorRole, action, target, desc) {
  try {
    append_('AuditLog', {
      LogID: newId_('log'),
      Timestamp: nowIso_(),
      ActorID: actorId || '',
      ActorRole: actorRole || '',
      Action: action,
      TargetRecord: target || '',
      Description: desc || ''
    });
  } catch (e) { /* never let logging break a request */ }
}

/* ============================ SESSION ============================ */

function createSession_(userId, role) {
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const expiresAt = new Date(Date.now() + CONFIG.SESSION_TTL_SECONDS * 1000).toISOString();
  append_('Sessions', { Token: token, UserID: userId, Role: role, ExpiresAt: expiresAt, CreatedAt: nowIso_() });
  try {
    CacheService.getScriptCache().put(
      CONFIG.SESSION_CACHE_PREFIX + token,
      JSON.stringify({ userId: userId, role: role, expiresAt: expiresAt }),
      CONFIG.SESSION_CACHE_SECONDS
    );
  } catch (e) {}
  return token;
}

function getSession_(token) {
  if (!token) return null;
  try {
    const c = CacheService.getScriptCache().get(CONFIG.SESSION_CACHE_PREFIX + token);
    if (c) {
      const s = JSON.parse(c);
      if (new Date(s.expiresAt).getTime() > Date.now()) return s;
    }
  } catch (e) {}
  const row = findOne_('Sessions', r => r.Token === token);
  if (!row) return null;
  if (new Date(row.ExpiresAt).getTime() <= Date.now()) return null;
  const s = { userId: row.UserID, role: row.Role, expiresAt: row.ExpiresAt };
  try {
    CacheService.getScriptCache().put(
      CONFIG.SESSION_CACHE_PREFIX + token, JSON.stringify(s), CONFIG.SESSION_CACHE_SECONDS
    );
  } catch (e) {}
  return s;
}

function destroySession_(token) {
  try { CacheService.getScriptCache().remove(CONFIG.SESSION_CACHE_PREFIX + token); } catch (e) {}
  const sh = sh_('Sessions');
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  const col = HEADERS.Sessions.indexOf('Token');
  for (let r = data.length - 1; r >= 1; r--) {
    if (data[r][col] === token) sh.deleteRow(r + 1);
  }
}

function pruneSessions_() {
  const now = Date.now();
  const sh = sh_('Sessions');
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return;
  const expCol = HEADERS.Sessions.indexOf('ExpiresAt');
  for (let r = data.length - 1; r >= 1; r--) {
    if (new Date(data[r][expCol]).getTime() < now) sh.deleteRow(r + 1);
  }
}

/* ============================ AUTH ============================ */

function login_(payload) {
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  if (!email || !password) throw new Error('Email and password are required');

  const lk = 'login:' + email;
  const cache = CacheService.getScriptCache();
  const attempts = Number(cache.get(lk) || 0);
  if (attempts >= CONFIG.LOGIN_LIMIT_PER_WINDOW) {
    throw new Error('Too many attempts. Please try again in a few minutes.');
  }
  cache.put(lk, String(attempts + 1), CONFIG.LOGIN_WINDOW_SECONDS);

  let user = null, role = null;
  const teacher = findOne_('Teachers', r => String(r.Email).toLowerCase() === email);
  if (teacher) {
    user = teacher;
    role = String(teacher.Role || 'teacher').toLowerCase() === 'admin' ? 'admin' : 'teacher';
  } else {
    const student = findOne_('Students', r => String(r.Email).toLowerCase() === email);
    if (student) { user = student; role = 'student'; }
  }
  if (!user) throw new Error('Invalid email or password');
  if (String(user.Status || '').toLowerCase() !== 'active') throw new Error('This account is not active');

  const expected = hashPwd_(password, user.PasswordSalt);
  if (expected !== user.PasswordHash) throw new Error('Invalid email or password');

  const userId = user.StudentID || user.TeacherID;
  const token = createSession_(userId, role);
  cache.remove(lk);
  pruneSessions_();
  logAudit_(userId, role, 'LOGIN', '', 'Successful login');
  return { token: token, user: publicUser_(user, role) };
}

function logout_(payload, session) {
  if (session) logAudit_(session.userId, session.role, 'LOGOUT', '', 'User logged out');
  if (payload.token) destroySession_(payload.token);
  return { ok: true };
}

function me_(session) {
  const user = session.role === 'student'
    ? findOne_('Students', r => r.StudentID === session.userId)
    : findOne_('Teachers', r => r.TeacherID === session.userId);
  if (!user) throw new Error('User not found');
  return { user: publicUser_(user, session.role) };
}

function publicUser_(user, role) {
  const id = user.StudentID || user.TeacherID;
  return {
    id: id,
    displayName: user.DisplayName,
    email: user.Email,
    role: role,
    classId: user.ClassID || '',
    classIds: splitIds_(user.ClassIDs || '')
  };
}

/* ============================ STUDENT ============================ */

function getStudentDashboard_(session) {
  if (session.role !== 'student') throw new Error('Student access only');
  const student = findOne_('Students', r => r.StudentID === session.userId);
  if (!student) throw new Error('Student not found');
  const classId = String(student.ClassID || '');

  const myTx = findMany_('ScoreTransactions', t => t.StudentID === session.userId && t.VerificationStatus === 'verified');
  const totalPoints = myTx.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0);
  const completedIds = new Set(myTx.map(t => t.ChallengeID));

  const allHunts = findMany_('TreasureHunts', h => h.Status === 'active' && truthy_(h.Published) && inRange_(h.StartDate, h.EndDate) && classAllowed_(h.AssignedClassIDs, classId));
  const allChallenges = findMany_('Challenges', c => c.Status === 'active' && inRange_(c.StartDate, c.EndDate) && classAllowed_(c.AssignedClassIDs, classId));
  const visibleChallengeIds = new Set(allChallenges.map(c => c.ChallengeID));
  const eligibleChallenges = allChallenges.filter(c => allHunts.some(h => h.HuntID === c.HuntID));

  const completed = eligibleChallenges.filter(c => completedIds.has(c.ChallengeID)).length;
  const remaining = eligibleChallenges.length - completed;

  const allStudentsClass = findMany_('Students', s => String(s.ClassID) === classId && String(s.Status).toLowerCase() === 'active');
  const classScores = allStudentsClass.map(s => ({
    id: s.StudentID,
    pts: findMany_('ScoreTransactions', t => t.StudentID === s.StudentID && t.VerificationStatus === 'verified').reduce((a, x) => a + Number(x.PointsAwarded || 0), 0)
  })).sort((a, b) => b.pts - a.pts);
  const classRank = 1 + classScores.filter(x => x.pts > totalPoints).length;

  const allActive = findMany_('Students', s => String(s.Status).toLowerCase() === 'active');
  const schoolScores = allActive.map(s => ({
    id: s.StudentID,
    pts: findMany_('ScoreTransactions', t => t.StudentID === s.StudentID && t.VerificationStatus === 'verified').reduce((a, x) => a + Number(x.PointsAwarded || 0), 0)
  }));
  const schoolRank = 1 + schoolScores.filter(x => x.pts > totalPoints).length;

  const recentResults = findMany_('QuizResults', r => r.StudentID === session.userId)
    .sort((a, b) => new Date(b.SubmittedAt) - new Date(a.SubmittedAt))
    .slice(0, 5)
    .map(r => ({
      challengeId: r.ChallengeID,
      challengeName: (findOne_('Challenges', c => c.ChallengeID === r.ChallengeID) || {}).Name || 'Challenge',
      score: Number(r.Score),
      maxScore: Number(r.MaxScore),
      passed: truthy_(r.Passed),
      submittedAt: r.SubmittedAt
    }));

  const recentActivity = myTx
    .sort((a, b) => new Date(b.TransactionTime) - new Date(a.TransactionTime))
    .slice(0, 5)
    .map(t => ({
      challengeName: (findOne_('Challenges', c => c.ChallengeID === t.ChallengeID) || {}).Name || 'Challenge',
      points: Number(t.PointsAwarded),
      time: t.TransactionTime
    }));

  const hunts = allHunts.map(h => {
    const chs = allChallenges.filter(c => c.HuntID === h.HuntID);
    const doneCount = chs.filter(c => completedIds.has(c.ChallengeID)).length;
    const total = chs.length;
    const maxPts = chs.reduce((a, c) => a + Number(c.MaxPoints || 0), 0);
    const earnedPts = chs.reduce((a, c) => a + (completedIds.has(c.ChallengeID) ? Number(c.MaxPoints || 0) : 0), 0);
    return {
      huntId: h.HuntID,
      name: h.Name,
      description: h.Description,
      completed: doneCount,
      total: total,
      percent: total ? Math.round((doneCount / total) * 100) : 0,
      earnedPoints: earnedPts,
      maxPoints: maxPts
    };
  });

  return {
    student: { displayName: student.DisplayName, classId: classId, className: className_(classId) },
    totalPoints: totalPoints,
    challengesCompleted: completed,
    challengesRemaining: remaining,
    classRank: classRank,
    schoolRank: schoolRank,
    recentResults: recentResults,
    recentActivity: recentActivity,
    hunts: hunts
  };
}

function getTreasureHunts_(session) {
  if (session.role !== 'student') throw new Error('Student access only');
  const student = findOne_('Students', r => r.StudentID === session.userId);
  const classId = String(student.ClassID || '');
  const myTx = findMany_('ScoreTransactions', t => t.StudentID === session.userId && t.VerificationStatus === 'verified');
  const doneIds = new Set(myTx.map(t => t.ChallengeID));

  const hunts = findMany_('TreasureHunts', h => h.Status === 'active' && truthy_(h.Published) && inRange_(h.StartDate, h.EndDate) && classAllowed_(h.AssignedClassIDs, classId));
  return hunts.map(h => {
    const chs = findMany_('Challenges', c => c.HuntID === h.HuntID && c.Status === 'active' && inRange_(c.StartDate, c.EndDate) && classAllowed_(c.AssignedClassIDs, classId));
    const done = chs.filter(c => doneIds.has(c.ChallengeID)).length;
    return {
      huntId: h.HuntID,
      name: h.Name,
      description: h.Description,
      instructions: h.Instructions,
      startDate: h.StartDate,
      endDate: h.EndDate,
      totalChallenges: chs.length,
      completedChallenges: done,
      percent: chs.length ? Math.round((done / chs.length) * 100) : 0
    };
  });
}

function getHunt_(payload, session) {
  const huntId = payload.huntId;
  const hunt = findOne_('TreasureHunts', h => h.HuntID === huntId);
  if (!hunt) throw new Error('Hunt not found');

  let classId = '';
  if (session.role === 'student') {
    const s = findOne_('Students', r => r.StudentID === session.userId);
    classId = String(s ? s.ClassID : '');
    if (!classAllowed_(hunt.AssignedClassIDs, classId)) throw new Error('Not available to your class');
  }

  const chs = findMany_('Challenges', c => c.HuntID === huntId && c.Status === 'active' && inRange_(c.StartDate, c.EndDate));
  const visible = session.role === 'student' ? chs.filter(c => classAllowed_(c.AssignedClassIDs, classId)) : chs;
  const doneIds = session.role === 'student'
    ? new Set(findMany_('ScoreTransactions', t => t.StudentID === session.userId && t.VerificationStatus === 'verified').map(t => t.ChallengeID))
    : new Set();

  return {
    hunt: {
      huntId: hunt.HuntID,
      name: hunt.Name,
      description: hunt.Description,
      instructions: hunt.Instructions,
      startDate: hunt.StartDate,
      endDate: hunt.EndDate
    },
    challenges: visible
      .sort((a, b) => Number(a.OrderIndex || 0) - Number(b.OrderIndex || 0))
      .map(c => ({
        challengeId: c.ChallengeID,
        name: c.Name,
        description: c.Description,
        maxPoints: Number(c.MaxPoints),
        passingPercent: Number(c.PassingPercent),
        order: Number(c.OrderIndex || 0),
        completed: doneIds.has(c.ChallengeID)
      }))
  };
}

function getChallengeByToken_(payload, session) {
  const token = String(payload.qrToken || '').trim();
  if (!token) throw new Error('Missing QR token');
  const challenge = findOne_('Challenges', c => String(c.QRToken) === token);
  if (!challenge) throw new Error('Invalid QR code. Challenge not found.');
  if (String(challenge.Status).toLowerCase() !== 'active') throw new Error('This challenge is not active.');
  if (!inRange_(challenge.StartDate, challenge.EndDate)) throw new Error('This challenge is not available right now.');

  const hunt = findOne_('TreasureHunts', h => h.HuntID === challenge.HuntID);
  if (!hunt) throw new Error('Associated hunt not found.');
  if (!truthy_(hunt.Published)) throw new Error('This hunt has not been published yet.');

  let completed = false;
  if (session.role === 'student') {
    const student = findOne_('Students', r => r.StudentID === session.userId);
    if (!student) throw new Error('Student not found');
    if (!classAllowed_(hunt.AssignedClassIDs, student.ClassID)) throw new Error('This hunt is not available to your class.');
    if (!classAllowed_(challenge.AssignedClassIDs, student.ClassID)) throw new Error('This challenge is not available to your class.');
    completed = !!findOne_('ScoreTransactions', t =>
      t.StudentID === session.userId && t.ChallengeID === challenge.ChallengeID && t.VerificationStatus === 'verified'
    );
  }

  return {
    challenge: {
      challengeId: challenge.ChallengeID,
      huntId: challenge.HuntID,
      huntName: hunt.Name,
      name: challenge.Name,
      description: challenge.Description,
      maxPoints: Number(challenge.MaxPoints),
      passingPercent: Number(challenge.PassingPercent),
      hasQuiz: !!challenge.QuizID,
      formUrl: challenge.FormURL || '',
      completed: completed
    }
  };
}

function getQuizForStudent_(payload, session) {
  const challengeId = payload.challengeId;
  const challenge = findOne_('Challenges', c => c.ChallengeID === challengeId);
  if (!challenge) throw new Error('Challenge not found');
  if (!challenge.QuizID) throw new Error('No built-in quiz on this challenge.');
  const quiz = findOne_('Quizzes', q => q.QuizID === challenge.QuizID);
  if (!quiz) throw new Error('Quiz not found');
  const questions = findMany_('Questions', q => q.QuizID === quiz.QuizID)
    .sort((a, b) => Number(a.OrderIndex || 0) - Number(b.OrderIndex || 0));

  return {
    quiz: {
      quizId: quiz.QuizID,
      title: quiz.Title,
      description: quiz.Description,
      timeLimitMinutes: Number(quiz.TimeLimitMinutes || 0),
      passingPercent: Number(challenge.PassingPercent)
    },
    questions: questions.map(q => ({
      questionId: q.QuestionID,
      type: q.Type,
      text: q.Text,
      options: parseJSON_(q.OptionsJSON, []),
      marks: Number(q.Marks || 1),
      order: Number(q.OrderIndex || 0)
    }))
  };
}

function submitQuiz_(payload, session) {
  if (session.role !== 'student') throw new Error('Student access only');
  const studentId = session.userId;
  const challengeId = String(payload.challengeId || '');
  const submissionId = String(payload.submissionId || '');
  const answers = payload.answers || {};

  if (!challengeId) throw new Error('Missing challengeId');
  if (!submissionId) throw new Error('Missing submissionId (idempotency key)');

  // Idempotency: return existing result if this submissionId has been processed
  const prev = findOne_('QuizResults', r => r.SubmissionID === submissionId);
  if (prev) {
    return {
      submissionId: prev.SubmissionID,
      score: Number(prev.Score),
      maxScore: Number(prev.MaxScore),
      passed: truthy_(prev.Passed),
      pointsAwarded: Number(findOne_('ScoreTransactions', t => t.StudentID === prev.StudentID && t.ChallengeID === prev.ChallengeID && t.VerificationStatus === 'verified')?.PointsAwarded || 0),
      alreadyProcessed: true
    };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // Re-check after acquiring lock
    const prev2 = findOne_('QuizResults', r => r.SubmissionID === submissionId);
    if (prev2) {
      return {
        submissionId: prev2.SubmissionID,
        score: Number(prev2.Score),
        maxScore: Number(prev2.MaxScore),
        passed: truthy_(prev2.Passed),
        pointsAwarded: 0,
        alreadyProcessed: true
      };
    }

    const challenge = findOne_('Challenges', c => c.ChallengeID === challengeId);
    if (!challenge) throw new Error('Challenge not found');
    if (String(challenge.Status).toLowerCase() !== 'active') throw new Error('Challenge not active');
    if (!inRange_(challenge.StartDate, challenge.EndDate)) throw new Error('Challenge not available');

    const student = findOne_('Students', r => r.StudentID === studentId);
    if (!student || String(student.Status).toLowerCase() !== 'active') throw new Error('Account inactive');
    if (!classAllowed_(challenge.AssignedClassIDs, student.ClassID)) throw new Error('Not available to your class');

    if (!challenge.QuizID) throw new Error('No built-in quiz on this challenge');
    const questions = findMany_('Questions', q => q.QuizID === challenge.QuizID);
    if (!questions.length) throw new Error('Quiz has no questions');

    let score = 0, maxScore = 0;
    questions.forEach(q => {
      const marks = Number(q.Marks || 1);
      maxScore += marks;
      const submitted = answers[q.QuestionID];
      if (submitted === undefined || submitted === null || submitted === '') return;
      if (String(submitted) === String(q.CorrectIndex)) score += marks;
    });
    const percent = maxScore ? (score / maxScore) * 100 : 0;
    const passPct = Number(challenge.PassingPercent || 0);
    const passed = percent >= passPct;

    // Idempotent insertion by submissionId
    append_('QuizResults', {
      SubmissionID: submissionId,
      StudentID: studentId,
      ChallengeID: challengeId,
      QuizID: challenge.QuizID,
      AnswersJSON: JSON.stringify(answers),
      Score: score,
      MaxScore: maxScore,
      Passed: passed,
      SubmittedAt: nowIso_(),
      GradingStatus: 'graded'
    });

    let pointsAwarded = 0;
    if (passed) {
      const already = findOne_('ScoreTransactions', t =>
        t.StudentID === studentId && t.ChallengeID === challengeId && t.VerificationStatus === 'verified'
      );
      if (!already) {
        pointsAwarded = Number(challenge.MaxPoints || 0);
        append_('ScoreTransactions', {
          TransactionID: newId_('tx'),
          StudentID: studentId,
          ChallengeID: challengeId,
          PointsAwarded: pointsAwarded,
          TransactionTime: nowIso_(),
          Reason: 'Built-in quiz passed (' + score + '/' + maxScore + ')',
          VerificationStatus: 'verified'
        });
        logAudit_(studentId, 'student', 'AWARD_POINTS', challengeId, 'Awarded ' + pointsAwarded + ' points');
      }
    }

    return {
      submissionId: submissionId,
      score: score,
      maxScore: maxScore,
      percent: Math.round(percent),
      passed: passed,
      pointsAwarded: pointsAwarded,
      passingPercent: passPct
    };
  } finally {
    lock.releaseLock();
  }
}

function getLeaderboard_(payload, session) {
  const scope = String(payload.scope || 'school');
  const classIdFilter = String(payload.classId || '');
  const huntIdFilter = String(payload.huntId || '');

  const students = findMany_('Students', s => String(s.Status).toLowerCase() === 'active');
  let txs = findMany_('ScoreTransactions', t => t.VerificationStatus === 'verified');

  if (huntIdFilter) {
    const chIds = new Set(findMany_('Challenges', c => c.HuntID === huntIdFilter).map(c => c.ChallengeID));
    txs = txs.filter(t => chIds.has(t.ChallengeID));
  }

  const agg = {};
  students.forEach(s => agg[s.StudentID] = { pts: 0, done: new Set() });
  txs.forEach(t => {
    if (!agg[t.StudentID]) return;
    agg[t.StudentID].pts += Number(t.PointsAwarded || 0);
    agg[t.StudentID].done.add(t.ChallengeID);
  });

  let rows = students.map(s => ({
    studentId: s.StudentID,
    displayName: s.DisplayName,
    classId: String(s.ClassID || ''),
    className: className_(s.ClassID),
    totalPoints: agg[s.StudentID].pts,
    challengesCompleted: agg[s.StudentID].done.size
  }));

  if (scope === 'class') {
    let cid = classIdFilter;
    if (!cid && session.role === 'student') {
      const me = findOne_('Students', s => s.StudentID === session.userId);
      cid = me ? String(me.ClassID) : '';
    }
    rows = rows.filter(r => r.classId === cid);
  }

  rows.sort((a, b) => b.totalPoints - a.totalPoints || a.displayName.localeCompare(b.displayName));

  let rank = 0, prev = null;
  rows = rows.map((r, i) => {
    if (prev === null || prev !== r.totalPoints) { rank = i + 1; prev = r.totalPoints; }
    return {
      rank: rank,
      displayName: r.displayName,
      className: r.className,
      totalPoints: r.totalPoints,
      challengesCompleted: r.challengesCompleted
    };
  });

  return { scope: scope, rows: rows };
}

function getMyProgress_(session) {
  if (session.role !== 'student') throw new Error('Student access only');
  const student = findOne_('Students', r => r.StudentID === session.userId);
  const classId = String(student.ClassID || '');
  const txs = findMany_('ScoreTransactions', t => t.StudentID === session.userId && t.VerificationStatus === 'verified');
  const doneIds = new Set(txs.map(t => t.ChallengeID));

  const hunts = findMany_('TreasureHunts', h => h.Status === 'active' && truthy_(h.Published) && classAllowed_(h.AssignedClassIDs, classId));
  return {
    hunts: hunts.map(h => {
      const chs = findMany_('Challenges', c => c.HuntID === h.HuntID && c.Status === 'active');
      return {
        huntId: h.HuntID,
        name: h.Name,
        challenges: chs.map(c => ({
          challengeId: c.ChallengeID,
          name: c.Name,
          maxPoints: Number(c.MaxPoints),
          completed: doneIds.has(c.ChallengeID)
        })),
        earnedPoints: chs.filter(c => doneIds.has(c.ChallengeID)).reduce((a, c) => a + Number(c.MaxPoints || 0), 0),
        maxPoints: chs.reduce((a, c) => a + Number(c.MaxPoints || 0), 0)
      };
    })
  };
}

function getMyAchievements_(session) {
  if (session.role !== 'student') throw new Error('Student access only');
  const txs = findMany_('ScoreTransactions', t => t.StudentID === session.userId && t.VerificationStatus === 'verified');
  const points = txs.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0);
  const completions = new Set(txs.map(t => t.ChallengeID)).size;
  const perfect = findMany_('QuizResults', r => r.StudentID === session.userId && truthy_(r.Passed) && Number(r.Score) === Number(r.MaxScore) && Number(r.MaxScore) > 0).length > 0;

  const all = [
    { id: 'first', name: 'First Steps', description: 'Complete 1 challenge', earned: completions >= 1, progress: Math.min(completions, 1), target: 1 },
    { id: 'explorer', name: 'Explorer', description: 'Complete 5 challenges', earned: completions >= 5, progress: Math.min(completions, 5), target: 5 },
    { id: 'adventurer', name: 'Adventurer', description: 'Complete 10 challenges', earned: completions >= 10, progress: Math.min(completions, 10), target: 10 },
    { id: 'scholar', name: 'Scholar', description: 'Earn 50 points', earned: points >= 50, progress: Math.min(points, 50), target: 50 },
    { id: 'champion', name: 'Champion', description: 'Earn 150 points', earned: points >= 150, progress: Math.min(points, 150), target: 150 },
    { id: 'legend', name: 'Legend', description: 'Earn 300 points', earned: points >= 300, progress: Math.min(points, 300), target: 300 },
    { id: 'perfect', name: 'Perfect Score', description: 'Pass a quiz with 100%', earned: perfect, progress: perfect ? 1 : 0, target: 1 }
  ];
  const next = all.find(a => !a.earned);
  return {
    points: points,
    completions: completions,
    badges: all,
    nextBadge: next ? { name: next.name, remaining: next.target - next.progress, target: next.target } : null
  };
}

function getMyProfile_(session) {
  const user = session.role === 'student'
    ? findOne_('Students', r => r.StudentID === session.userId)
    : findOne_('Teachers', r => r.TeacherID === session.userId);
  if (!user) throw new Error('User not found');
  return {
    id: session.userId,
    role: session.role,
    displayName: user.DisplayName,
    email: user.Email,
    classId: user.ClassID || '',
    className: className_(user.ClassID)
  };
}

function updateMyProfile_(payload, session) {
  const name = String(payload.displayName || '').trim();
  if (!name || name.length > 60) throw new Error('Display name must be 1-60 characters');
  if (session.role === 'student') {
    updateById_('Students', 'StudentID', session.userId, { DisplayName: name });
  } else {
    updateById_('Teachers', 'TeacherID', session.userId, { DisplayName: name });
  }
  logAudit_(session.userId, session.role, 'UPDATE_PROFILE', '', 'Name updated');
  return { ok: true };
}

/* ============================ TEACHER ============================ */

function teacherGetOverview_(session) {
  const teacher = findOne_('Teachers', r => r.TeacherID === session.userId);
  const classes = splitIds_(teacher.ClassIDs || '');
  const allStudents = findMany_('Students', s => String(s.Status).toLowerCase() === 'active');
  const myStudents = session.role === 'admin' ? allStudents : allStudents.filter(s => classes.includes(String(s.ClassID)));
  const hunts = findMany_('TreasureHunts', h => h.Status !== 'archived');
  const challenges = findMany_('Challenges', c => c.Status !== 'archived');
  const txs = findMany_('ScoreTransactions', t => t.VerificationStatus === 'verified');
  const myStudentIds = new Set(myStudents.map(s => s.StudentID));
  const myTx = txs.filter(t => myStudentIds.has(t.StudentID));

  return {
    stats: {
      students: myStudents.length,
      hunts: hunts.length,
      challenges: challenges.length,
      totalPointsAwarded: myTx.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0),
      submissions: findMany_('QuizResults', r => true).length
    }
  };
}

function teacherGetHunts_(session) {
  return findMany_('TreasureHunts', h => h.Status !== 'archived').map(h => {
    const chs = findMany_('Challenges', c => c.HuntID === h.HuntID && c.Status !== 'archived');
    return {
      huntId: h.HuntID,
      name: h.Name,
      description: h.Description,
      instructions: h.Instructions,
      startDate: h.StartDate,
      endDate: h.EndDate,
      status: h.Status,
      published: truthy_(h.Published),
      assignedClassIds: splitIds_(h.AssignedClassIDs),
      challengeCount: chs.length,
      createdBy: h.CreatedBy
    };
  });
}

function teacherCreateHunt_(payload, session) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Name required');
  const hunt = {
    HuntID: newId_('hunt'),
    Name: name,
    Description: payload.description || '',
    Instructions: payload.instructions || '',
    CreatedBy: session.userId,
    StartDate: payload.startDate || '',
    EndDate: payload.endDate || '',
    Status: 'active',
    AssignedClassIDs: (payload.classIds || []).join(','),
    Published: !!payload.published,
    CreatedAt: nowIso_()
  };
  append_('TreasureHunts', hunt);
  logAudit_(session.userId, session.role, 'CREATE_HUNT', hunt.HuntID, name);
  return { huntId: hunt.HuntID };
}

function teacherUpdateHunt_(payload, session) {
  const updates = {};
  ['name','description','instructions','startDate','endDate','status'].forEach(k => {
    if (payload[k] !== undefined) updates[k[0].toUpperCase() + k.slice(1)] = payload[k];
  });
  if (payload.classIds !== undefined) updates.AssignedClassIDs = (payload.classIds || []).join(',');
  if (payload.published !== undefined) updates.Published = !!payload.published;
  if (!updateById_('TreasureHunts', 'HuntID', payload.huntId, updates)) throw new Error('Hunt not found');
  logAudit_(session.userId, session.role, 'UPDATE_HUNT', payload.huntId, '');
  return { ok: true };
}

function teacherDeleteHunt_(payload, session) {
  updateById_('TreasureHunts', 'HuntID', payload.huntId, { Status: 'archived', Published: false });
  logAudit_(session.userId, session.role, 'ARCHIVE_HUNT', payload.huntId, '');
  return { ok: true };
}

function teacherGetChallenges_(payload, session) {
  const huntId = payload.huntId || '';
  const where = huntId ? (c => c.HuntID === huntId && c.Status !== 'archived') : (c => c.Status !== 'archived');
  return findMany_('Challenges', where).map(c => ({
    challengeId: c.ChallengeID,
    huntId: c.HuntID,
    name: c.Name,
    description: c.Description,
    qrToken: c.QRToken,
    quizId: c.QuizID,
    formUrl: c.FormURL,
    maxPoints: Number(c.MaxPoints),
    passingPercent: Number(c.PassingPercent),
    startDate: c.StartDate,
    endDate: c.EndDate,
    status: c.Status,
    assignedClassIds: splitIds_(c.AssignedClassIDs),
    orderIndex: Number(c.OrderIndex || 0)
  }));
}

function teacherCreateChallenge_(payload, session) {
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Name required');
  if (!payload.huntId) throw new Error('Hunt required');
  const c = {
    ChallengeID: newId_('ch'),
    HuntID: payload.huntId,
    Name: name,
    Description: payload.description || '',
    QRToken: 'qr_' + Utilities.getUuid().replace(/-/g, ''),
    QuizID: payload.quizId || '',
    FormURL: payload.formUrl || '',
    MaxPoints: Number(payload.maxPoints || 0),
    PassingPercent: Number(payload.passingPercent || 0),
    StartDate: payload.startDate || '',
    EndDate: payload.endDate || '',
    Status: 'active',
    AssignedClassIDs: (payload.classIds || []).join(','),
    OrderIndex: Number(payload.orderIndex || 0),
    CreatedAt: nowIso_()
  };
  append_('Challenges', c);
  logAudit_(session.userId, session.role, 'CREATE_CHALLENGE', c.ChallengeID, name);
  return { challengeId: c.ChallengeID, qrToken: c.QRToken };
}

function teacherUpdateChallenge_(payload, session) {
  const updates = {};
  ['name','description','startDate','endDate','status'].forEach(k => {
  if (payload[k] !== undefined) updates[k[0].toUpperCase() + k.slice(1)] = payload[k];
});
if (payload.quizId  !== undefined) updates.QuizID  = payload.quizId;
if (payload.formUrl !== undefined) updates.FormURL = payload.formUrl;
  });
  if (payload.maxPoints !== undefined) updates.MaxPoints = Number(payload.maxPoints);
  if (payload.passingPercent !== undefined) updates.PassingPercent = Number(payload.passingPercent);
  if (payload.orderIndex !== undefined) updates.OrderIndex = Number(payload.orderIndex);
  if (payload.classIds !== undefined) updates.AssignedClassIDs = (payload.classIds || []).join(',');
  if (!updateById_('Challenges', 'ChallengeID', payload.challengeId, updates)) throw new Error('Challenge not found');
  logAudit_(session.userId, session.role, 'UPDATE_CHALLENGE', payload.challengeId, '');
  return { ok: true };
}

function teacherRegenerateToken_(payload, session) {
  const token = 'qr_' + Utilities.getUuid().replace(/-/g, '');
  if (!updateById_('Challenges', 'ChallengeID', payload.challengeId, { QRToken: token })) throw new Error('Challenge not found');
  logAudit_(session.userId, session.role, 'REGEN_TOKEN', payload.challengeId, '');
  return { qrToken: token };
}

function teacherDisableChallenge_(payload, session) {
  updateById_('Challenges', 'ChallengeID', payload.challengeId, { Status: 'archived' });
  logAudit_(session.userId, session.role, 'ARCHIVE_CHALLENGE', payload.challengeId, '');
  return { ok: true };
}

function teacherGetQuizzes_(session) {
  return findMany_('Quizzes', q => q.Status !== 'archived').map(q => ({
    quizId: q.QuizID,
    title: q.Title,
    description: q.Description,
    timeLimitMinutes: Number(q.TimeLimitMinutes || 0),
    passingPercent: Number(q.PassingPercent || 0),
    status: q.Status,
    questionCount: findMany_('Questions', x => x.QuizID === q.QuizID).length
  }));
}

function teacherGetQuiz_(payload, session) {
  const quiz = findOne_('Quizzes', q => q.QuizID === payload.quizId);
  if (!quiz) throw new Error('Quiz not found');
  const questions = findMany_('Questions', q => q.QuizID === quiz.QuizID)
    .sort((a, b) => Number(a.OrderIndex || 0) - Number(b.OrderIndex || 0))
    .map(q => ({
      questionId: q.QuestionID,
      type: q.Type,
      text: q.Text,
      options: parseJSON_(q.OptionsJSON, []),
      correctIndex: Number(q.CorrectIndex),
      explanation: q.Explanation,
      marks: Number(q.Marks || 1),
      orderIndex: Number(q.OrderIndex || 0)
    }));
  return {
    quiz: {
      quizId: quiz.QuizID,
      title: quiz.Title,
      description: quiz.Description,
      timeLimitMinutes: Number(quiz.TimeLimitMinutes || 0),
      passingPercent: Number(quiz.PassingPercent || 0),
      status: quiz.Status
    },
    questions: questions
  };
}

function teacherSaveQuiz_(payload, session) {
  const title = String(payload.title || '').trim();
  if (!title) throw new Error('Title required');
  const questions = Array.isArray(payload.questions) ? payload.questions : [];
  if (!questions.length) throw new Error('At least one question required');

  const quizId = payload.quizId || newId_('quiz');
  const quizFields = {
    QuizID: quizId,
    Title: title,
    Description: payload.description || '',
    TimeLimitMinutes: Number(payload.timeLimitMinutes || 0),
    PassingPercent: Number(payload.passingPercent || 0),
    Status: 'active',
    CreatedAt: nowIso_()
  };
  if (payload.quizId) {
    updateById_('Quizzes', 'QuizID', payload.quizId, {
      Title: quizFields.Title,
      Description: quizFields.Description,
      TimeLimitMinutes: quizFields.TimeLimitMinutes,
      PassingPercent: quizFields.PassingPercent,
      Status: 'active'
    });
    // Delete existing questions
    const sh = sh_('Questions');
    const data = sh.getDataRange().getValues();
    const idCol = HEADERS.Questions.indexOf('QuizID');
    for (let r = data.length - 1; r >= 1; r--) {
      if (data[r][idCol] === payload.quizId) sh.deleteRow(r + 1);
    }
  } else {
    append_('Quizzes', quizFields);
  }

  questions.forEach((q, i) => {
    append_('Questions', {
      QuestionID: newId_('q'),
      QuizID: quizId,
      Type: q.type || 'mc',
      Text: q.text || '',
      OptionsJSON: JSON.stringify(q.options || []),
      CorrectIndex: Number(q.correctIndex || 0),
      Explanation: q.explanation || '',
      Marks: Number(q.marks || 1),
      OrderIndex: i
    });
  });

  logAudit_(session.userId, session.role, payload.quizId ? 'UPDATE_QUIZ' : 'CREATE_QUIZ', quizId, title);
  return { quizId: quizId };
}

function teacherDeleteQuiz_(payload, session) {
  updateById_('Quizzes', 'QuizID', payload.quizId, { Status: 'archived' });
  logAudit_(session.userId, session.role, 'ARCHIVE_QUIZ', payload.quizId, '');
  return { ok: true };
}

function teacherGetStudents_(payload, session) {
  const teacher = findOne_('Teachers', r => r.TeacherID === session.userId);
  const myClasses = splitIds_(teacher.ClassIDs || '');
  const all = findMany_('Students', s => String(s.Status).toLowerCase() === 'active');
  const visible = session.role === 'admin' ? all : all.filter(s => myClasses.includes(String(s.ClassID)));
  const txAll = findMany_('ScoreTransactions', t => t.VerificationStatus === 'verified');
  return visible.map(s => {
    const myTx = txAll.filter(t => t.StudentID === s.StudentID);
    return {
      studentId: s.StudentID,
      displayName: s.DisplayName,
      email: s.Email,
      classId: s.ClassID || '',
      className: className_(s.ClassID),
      totalPoints: myTx.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0),
      challengesCompleted: new Set(myTx.map(t => t.ChallengeID)).size
    };
  });
}

function teacherGetStudentReport_(payload, session) {
  const student = findOne_('Students', s => s.StudentID === payload.studentId);
  if (!student) throw new Error('Student not found');
  const teacher = findOne_('Teachers', r => r.TeacherID === session.userId);
  const myClasses = splitIds_(teacher.ClassIDs || '');
  if (session.role !== 'admin' && !myClasses.includes(String(student.ClassID))) {
    throw new Error('Not authorized for this student');
  }
  const tx = findMany_('ScoreTransactions', t => t.StudentID === student.StudentID && t.VerificationStatus === 'verified');
  const results = findMany_('QuizResults', r => r.StudentID === student.StudentID);
  return {
    student: {
      studentId: student.StudentID,
      displayName: student.DisplayName,
      className: className_(student.ClassID),
      email: student.Email
    },
    totalPoints: tx.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0),
    challenges: tx.map(t => ({
      challengeId: t.ChallengeID,
      challengeName: (findOne_('Challenges', c => c.ChallengeID === t.ChallengeID) || {}).Name || 'Challenge',
      points: Number(t.PointsAwarded),
      time: t.TransactionTime
    })),
    submissions: results.map(r => ({
      submissionId: r.SubmissionID,
      challengeId: r.ChallengeID,
      score: Number(r.Score),
      maxScore: Number(r.MaxScore),
      passed: truthy_(r.Passed),
      submittedAt: r.SubmittedAt
    }))
  };
}

function teacherGetReports_(payload, session) {
  const classId = payload.classId || '';
  const huntId = payload.huntId || '';
  const allStudents = findMany_('Students', s => String(s.Status).toLowerCase() === 'active');
  const filteredStudents = classId ? allStudents.filter(s => String(s.ClassID) === classId) : allStudents;
  let chs = findMany_('Challenges', c => c.Status === 'active');
  if (huntId) chs = chs.filter(c => c.HuntID === huntId);
  const chIds = new Set(chs.map(c => c.ChallengeID));
  const txs = findMany_('ScoreTransactions', t => t.VerificationStatus === 'verified' && chIds.has(t.ChallengeID));

  const rows = filteredStudents.map(s => {
    const my = txs.filter(t => t.StudentID === s.StudentID);
    return {
      studentId: s.StudentID,
      displayName: s.DisplayName,
      className: className_(s.ClassID),
      totalPoints: my.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0),
      challengesCompleted: new Set(my.map(t => t.ChallengeID)).size
    };
  });

  const challengeStats = chs.map(c => {
    const done = new Set(txs.filter(t => t.ChallengeID === c.ChallengeID).map(t => t.StudentID)).size;
    return {
      challengeId: c.ChallengeID,
      name: c.Name,
      huntName: (findOne_('TreasureHunts', h => h.HuntID === c.HuntID) || {}).Name || '',
      completedBy: done,
      totalStudents: filteredStudents.length,
      completionRate: filteredStudents.length ? Math.round((done / filteredStudents.length) * 100) : 0
    };
  });

  const totalParticipants = rows.filter(r => r.challengesCompleted > 0).length;
  const totalPoints = rows.reduce((a, r) => a + r.totalPoints, 0);
  return {
    students: rows,
    challengeStats: challengeStats,
    summary: {
      participatingStudents: totalParticipants,
      totalStudents: filteredStudents.length,
      totalPoints: totalPoints,
      averagePoints: filteredStudents.length ? Math.round(totalPoints / filteredStudents.length) : 0
    }
  };
}

function teacherGetAudit_(payload, session) {
  const limit = Number(payload.limit || 100);
  return findMany_('AuditLog', () => true)
    .sort((a, b) => new Date(b.Timestamp) - new Date(a.Timestamp))
    .slice(0, limit);
}

function teacherGetClasses_(session) {
  return readAll_('Classes').map(c => ({
    classId: c.ClassID,
    className: c.ClassName,
    teacherIds: splitIds_(c.TeacherIDs)
  }));
}

function className_(classId) {
  if (!classId) return '';
  const c = findOne_('Classes', x => x.ClassID === classId);
  return c ? c.ClassName : '';
}

/* ============================ ADMIN ============================ */

function adminGetUsers_(session) {
  return {
    students: readAll_('Students').map(s => ({
      id: s.StudentID, displayName: s.DisplayName, email: s.Email,
      classId: s.ClassID, className: className_(s.ClassID), status: s.Status
    })),
    teachers: readAll_('Teachers').map(t => ({
      id: t.TeacherID, displayName: t.DisplayName, email: t.Email,
      role: t.Role, classIds: splitIds_(t.ClassIDs), status: t.Status
    }))
  };
}

function adminCreateTeacher_(payload, session) {
  const email = String(payload.email || '').trim().toLowerCase();
  const displayName = String(payload.displayName || '').trim();
  const password = String(payload.password || '');
  const role = String(payload.role || 'teacher').toLowerCase() === 'admin' ? 'admin' : 'teacher';
  const classIds = Array.isArray(payload.classIds) ? payload.classIds.join(',') : '';
  if (!email || !displayName || !password) throw new Error('email, displayName, password required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  if (findOne_('Teachers', t => String(t.Email).toLowerCase() === email)) throw new Error('Email already registered');
  const salt = genSalt_();
  const t = {
    TeacherID: newId_('t'),
    DisplayName: displayName,
    Email: email,
    PasswordHash: hashPwd_(password, salt),
    PasswordSalt: salt,
    Role: role,
    ClassIDs: classIds,
    Status: 'active',
    CreatedAt: nowIso_()
  };
  append_('Teachers', t);
  logAudit_(session.userId, session.role, 'CREATE_TEACHER', t.TeacherID, email);
  return { teacherId: t.TeacherID };
}

function adminCreateStudent_(payload, session) {
  const email = String(payload.email || '').trim().toLowerCase();
  const displayName = String(payload.displayName || '').trim();
  const password = String(payload.password || '');
  const classId = String(payload.classId || '');
  if (!email || !displayName || !password) throw new Error('email, displayName, password required');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  if (findOne_('Students', s => String(s.Email).toLowerCase() === email)) throw new Error('Email already registered');
  const salt = genSalt_();
  const s = {
    StudentID: newId_('s'),
    DisplayName: displayName,
    Email: email,
    PasswordHash: hashPwd_(password, salt),
    PasswordSalt: salt,
    ClassID: classId,
    Status: 'active',
    CreatedAt: nowIso_()
  };
  append_('Students', s);
  logAudit_(session.userId, session.role, 'CREATE_STUDENT', s.StudentID, email);
  return { studentId: s.StudentID };
}

function adminUpdateUserStatus_(payload, session) {
  const status = String(payload.status || 'active').toLowerCase();
  const type = payload.type === 'teacher' ? 'Teachers' : 'Students';
  const idField = payload.type === 'teacher' ? 'TeacherID' : 'StudentID';
  if (!updateById_(type, idField, payload.userId, { Status: status })) throw new Error('User not found');
  logAudit_(session.userId, session.role, 'UPDATE_STATUS', payload.userId, status);
  return { ok: true };
}

function adminUpdateUserClass_(payload, session) {
  if (!updateById_('Students', 'StudentID', payload.studentId, { ClassID: payload.classId })) throw new Error('Student not found');
  logAudit_(session.userId, session.role, 'UPDATE_STUDENT_CLASS', payload.studentId, payload.classId);
  return { ok: true };
}

function adminResetPassword_(payload, session) {
  const password = String(payload.password || '');
  if (password.length < 6) throw new Error('Password must be at least 6 characters');
  const salt = genSalt_();
  const type = payload.type === 'teacher' ? 'Teachers' : 'Students';
  const idField = payload.type === 'teacher' ? 'TeacherID' : 'StudentID';
  const ok = updateById_(type, idField, payload.userId, { PasswordHash: hashPwd_(password, salt), PasswordSalt: salt });
  if (!ok) throw new Error('User not found');
  logAudit_(session.userId, session.role, 'RESET_PASSWORD', payload.userId, '');
  return { ok: true };
}

function adminGetClasses_() { return teacherGetClasses_(); }

function adminCreateClass_(payload, session) {
  const className = String(payload.className || '').trim();
  if (!className) throw new Error('className required');
  const c = { ClassID: newId_('cls'), ClassName: className, TeacherIDs: (payload.teacherIds || []).join(','), CreatedAt: nowIso_() };
  append_('Classes', c);
  logAudit_(session.userId, session.role, 'CREATE_CLASS', c.ClassID, className);
  return { classId: c.ClassID };
}

function adminAssignTeacherToClass_(payload, session) {
  const cls = findOne_('Classes', c => c.ClassID === payload.classId);
  if (!cls) throw new Error('Class not found');
  const ids = new Set(splitIds_(cls.TeacherIDs));
  if (payload.add) ids.add(payload.teacherId); else ids.delete(payload.teacherId);
  updateById_('Classes', 'ClassID', payload.classId, { TeacherIDs: Array.from(ids).join(',') });
  // Update teacher's ClassIDs
  const teacher = findOne_('Teachers', t => t.TeacherID === payload.teacherId);
  if (teacher) {
    const tids = new Set(splitIds_(teacher.ClassIDs));
    if (payload.add) tids.add(payload.classId); else tids.delete(payload.classId);
    updateById_('Teachers', 'TeacherID', payload.teacherId, { ClassIDs: Array.from(tids).join(',') });
  }
  logAudit_(session.userId, session.role, 'ASSIGN_TEACHER', payload.classId, payload.teacherId);
  return { ok: true };
}

function adminGetAudit_(payload) { return teacherGetAudit_(payload); }

function adminGetStats_() {
  const students = findMany_('Students', s => String(s.Status).toLowerCase() === 'active').length;
  const teachers = findMany_('Teachers', t => String(t.Status).toLowerCase() === 'active').length;
  const classes = readAll_('Classes').length;
  const hunts = findMany_('TreasureHunts', h => h.Status === 'active').length;
  const txs = findMany_('ScoreTransactions', t => t.VerificationStatus === 'verified');
  const results = readAll_('QuizResults').length;
  return {
    students: students, teachers: teachers, classes: classes, hunts: hunts,
    totalPointsAwarded: txs.reduce((a, t) => a + Number(t.PointsAwarded || 0), 0),
    totalSubmissions: results
  };
}

/* ============================ SETUP (run once from Editor) ============================ */

/**
 * Run this ONCE from the Apps Script editor after setting SPREADSHEET_ID.
 * Creates all sheets with headers and an initial admin user.
 */
function setup() {
  const names = Object.keys(HEADERS);
  names.forEach(n => sh_(n));

  // Seed default classes if none exist
  if (!readAll_('Classes').length) {
    append_('Classes', { ClassID: 'cls_default', ClassName: 'Class A', TeacherIDs: '', CreatedAt: nowIso_() });
  }

  // Seed admin if no users exist
  if (!readAll_('Teachers').length) {
    const salt = genSalt_();
    const admin = {
      TeacherID: newId_('t'),
      DisplayName: 'Administrator',
      Email: 'admin@school.local',
      PasswordHash: hashPwd_('ChangeMe123!', salt),
      PasswordSalt: salt,
      Role: 'admin',
      ClassIDs: '',
      Status: 'active',
      CreatedAt: nowIso_()
    };
    append_('Teachers', admin);
    Logger.log('Created initial admin: admin@school.local / ChangeMe123! — CHANGE THIS PASSWORD.');
  }
  Logger.log('Setup complete.');
}
