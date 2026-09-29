(function () {
  "use strict";

  const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const TABLE_BY_COLLECTION = Object.freeze({
    members: "members",
    trainings: "training_schedules",
    attendance: "attendance",
    points: "points",
    messages: "messages",
    activities: "activities",
  });

  function emitSync(state, message = "") {
    window.dispatchEvent(new CustomEvent("vsi:sync-state", { detail: { state, message } }));
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function uuid() {
    if (typeof crypto?.randomUUID === "function") return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function shortTime(value, fallback = "00:00") {
    const match = /^(\d{2}):(\d{2})/.exec(String(value || ""));
    return match ? `${match[1]}:${match[2]}` : fallback;
  }

  function required(result, label) {
    if (result?.error) {
      const error = new Error(result.error.message || `${label} kunne ikke hentes.`);
      error.cause = result.error;
      throw error;
    }
    return result?.data || [];
  }

  function fromMember(row) {
    const member = {
      id: row.id,
      name: row.full_name,
      role: row.member_role || "",
      team: row.team || "",
      email: row.contact_email || "",
      phone: row.phone || "",
      active: row.active !== false,
    };
    if (row.user_id) member.userId = row.user_id;
    if (row.created_at) member.createdAt = row.created_at;
    if (row.updated_at) member.updatedAt = row.updated_at;
    return member;
  }

  function fromTraining(row) {
    const training = {
      id: row.id,
      title: row.title,
      weekday: Number(row.weekday),
      time: shortTime(row.start_time, "18:00"),
      location: row.location,
    };
    if (row.created_at) training.createdAt = row.created_at;
    if (row.updated_at) training.updatedAt = row.updated_at;
    return training;
  }

  function fromAttendance(row) {
    const attendance = {
      id: row.id,
      memberId: row.member_id,
      date: row.attendance_date,
      status: row.status,
    };
    if (row.created_at) attendance.createdAt = row.created_at;
    if (row.updated_at) attendance.updatedAt = row.updated_at;
    return attendance;
  }

  function fromPoint(row) {
    const point = {
      id: row.id,
      memberId: row.member_id,
      amount: Number(row.amount),
      reason: row.reason,
      category: row.category || "other",
    };
    if (row.awarded_at || row.created_at) point.createdAt = row.awarded_at || row.created_at;
    return point;
  }

  function fromMessage(row) {
    const message = {
      id: row.id,
      title: row.title,
      body: row.body,
      createdAt: row.published_at || row.created_at,
    };
    if (row.updated_at) message.updatedAt = row.updated_at;
    return message;
  }

  function fromActivity(row) {
    const activity = {
      id: row.id,
      title: row.title,
      category: row.kind || "activity",
      date: row.activity_date,
      time: shortTime(row.start_time),
      location: row.location,
      notes: row.notes || "",
    };
    if (row.created_at) activity.createdAt = row.created_at;
    if (row.updated_at) activity.updatedAt = row.updated_at;
    return activity;
  }

  function prepareSnapshot(source) {
    const data = clone(source);
    const memberIds = new Map();
    data.members = (data.members || []).map((item) => {
      const nextId = UUID_PATTERN.test(String(item.id)) ? item.id : uuid();
      memberIds.set(item.id, nextId);
      return { ...item, id: nextId };
    });
    for (const collection of ["trainings", "attendance", "points", "messages", "activities"]) {
      data[collection] = (data[collection] || []).map((item) => ({
        ...item,
        id: UUID_PATTERN.test(String(item.id)) ? item.id : uuid(),
        ...(["attendance", "points"].includes(collection)
          ? { memberId: memberIds.get(item.memberId) || item.memberId }
          : {}),
      }));
    }
    data.schemaVersion = 1;
    return data;
  }

  function insertRow(collection, item, clubId) {
    if (collection === "members") return {
      id: item.id,
      club_id: clubId,
      full_name: item.name,
      member_role: item.role || "Medlem",
      team: item.team || null,
      contact_email: item.email || null,
      phone: item.phone || null,
      active: item.active !== false,
    };
    if (collection === "trainings") return {
      id: item.id,
      club_id: clubId,
      title: item.title,
      weekday: Number(item.weekday),
      start_time: item.time,
      location: item.location,
    };
    if (collection === "attendance") return {
      id: item.id,
      club_id: clubId,
      member_id: item.memberId,
      attendance_date: item.date,
      status: item.status,
    };
    if (collection === "points") return {
      id: item.id,
      club_id: clubId,
      member_id: item.memberId,
      amount: Number(item.amount),
      reason: item.reason,
      category: item.category || "other",
      awarded_at: item.createdAt || new Date().toISOString(),
    };
    if (collection === "messages") return {
      id: item.id,
      club_id: clubId,
      title: item.title,
      body: item.body,
      published_at: item.createdAt || new Date().toISOString(),
    };
    if (collection === "activities") return {
      id: item.id,
      club_id: clubId,
      kind: item.category || "activity",
      activity_date: item.date,
      start_time: item.time || null,
      title: item.title,
      location: item.location,
      notes: item.notes || null,
    };
    throw new Error(`Ukendt datasamling: ${collection}`);
  }

  function updateRow(collection, item) {
    const row = insertRow(collection, item, "unused");
    delete row.id;
    delete row.club_id;
    return row;
  }

  function comparable(collection, item) {
    return JSON.stringify(updateRow(collection, item));
  }

  function diff(previous, next, collection) {
    const oldById = new Map((previous[collection] || []).map((item) => [item.id, item]));
    const newById = new Map((next[collection] || []).map((item) => [item.id, item]));
    return {
      added: [...newById.values()].filter((item) => !oldById.has(item.id)),
      changed: [...newById.values()].filter((item) => oldById.has(item.id) && comparable(collection, oldById.get(item.id)) !== comparable(collection, item)),
      removed: [...oldById.values()].filter((item) => !newById.has(item.id)),
    };
  }

  function rankRows(source, mode = "combined") {
    const rows = source.map((item) => {
      const points = Number(item.total_points || 0);
      const present = Number(item.attendance_count || 0);
      const score = mode === "points" ? points : mode === "attendance" ? present : points + present;
      const member = {
        id: item.member_id,
        name: item.full_name,
        role: item.member_role || "",
        team: item.team || "",
      };
      return { member, memberId: item.member_id, name: item.full_name, points, totalPoints: points, present, score, mode };
    });
    rows.sort((left, right) => right.score - left.score || right.points - left.points || left.name.localeCompare(right.name, "da-DK"));
    let priorScore;
    let priorRank = 0;
    return rows.map((row, index) => {
      if (index === 0 || row.score !== priorScore) priorRank = index + 1;
      priorScore = row.score;
      return { ...row, rank: priorRank };
    });
  }

  function create({ client, context }) {
    if (!client || !context?.membership?.club_id) throw new Error("Login-konteksten mangler.");
    const clubId = context.membership.club_id;
    const userId = context.user.id;
    const isAdmin = context.membership.role === "admin";
    let lastMeta = null;
    let channel = null;
    let refreshTimer = null;
    let suppressRealtime = false;

    async function loadSnapshot(options = {}) {
      if (!options.silent) emitSync("syncing", "Henter klubdata");
      try {
        const memberQuery = isAdmin
          ? client.from("members").select("id, club_id, user_id, full_name, member_role, team, contact_email, phone, active, created_at, updated_at").eq("club_id", clubId).order("full_name")
          : client.from("member_directory").select("id, club_id, full_name, member_role, team, active").eq("club_id", clubId).order("full_name");
        const queries = await Promise.all([
          memberQuery,
          client.from("training_schedules").select("id, club_id, title, weekday, start_time, end_time, location, created_at, updated_at").eq("club_id", clubId).order("weekday").order("start_time"),
          client.from("attendance").select("id, club_id, member_id, attendance_date, status, created_at, updated_at").eq("club_id", clubId).order("attendance_date", { ascending: false }),
          client.from("points").select("id, club_id, member_id, amount, reason, category, awarded_at, created_at").eq("club_id", clubId).order("awarded_at", { ascending: false }),
          client.from("messages").select("id, club_id, title, body, published_at, created_at, updated_at").eq("club_id", clubId).order("published_at", { ascending: false }),
          client.from("activities").select("id, club_id, kind, activity_date, start_time, title, location, notes, created_at, updated_at").eq("club_id", clubId).order("activity_date"),
          client.from("leaderboard").select("member_id, club_id, full_name, member_role, team, total_points, attendance_count, combined_score, combined_rank").eq("club_id", clubId),
          client.from("club_daily_attendance").select("club_id, attendance_date, present_count, excused_count, absent_count").eq("club_id", clubId),
        ]);

        const members = required(queries[0], "Medlemmer").map(fromMember);
        if (!isAdmin) {
          const ownResult = await client.from("members").select("id, club_id, user_id, full_name, member_role, team, contact_email, phone, active, created_at, updated_at").eq("club_id", clubId).eq("user_id", userId).maybeSingle();
          if (ownResult.error) throw ownResult.error;
          if (ownResult.data) {
            const own = fromMember(ownResult.data);
            const index = members.findIndex((member) => member.id === own.id);
            if (index >= 0) members[index] = own;
            else members.push(own);
          }
        }

        const leaderboardSource = required(queries[6], "Rangliste");
        const dailyAttendance = required(queries[7], "Dagens fremmøde");
        const data = {
          schemaVersion: 1,
          members,
          trainings: required(queries[1], "Træningstider").map(fromTraining),
          attendance: required(queries[2], "Fremmøde").map(fromAttendance),
          points: required(queries[3], "Point").map(fromPoint),
          messages: required(queries[4], "Beskeder").map(fromMessage),
          activities: required(queries[5], "Kalender").map(fromActivity),
        };
        lastMeta = {
          isAdmin,
          clubId,
          userId,
          leaderboardSource,
          dailyAttendance,
          totalClubPoints: leaderboardSource.reduce((sum, row) => sum + Number(row.total_points || 0), 0),
          totalClubAttendance: dailyAttendance.reduce((sum, row) => sum + Number(row.present_count || 0) + Number(row.excused_count || 0) + Number(row.absent_count || 0), 0),
        };
        emitSync("ready", "Klubdata er synkroniseret");
        return { data, meta: lastMeta, issue: null };
      } catch (error) {
        emitSync("error", error?.message || "Klubdata kunne ikke hentes");
        throw error;
      }
    }

    async function insertItems(collection, items) {
      if (!items.length) return;
      const table = TABLE_BY_COLLECTION[collection];
      const result = await client.from(table).insert(items.map((item) => insertRow(collection, item, clubId))).select("id");
      if (result.error) throw result.error;
      if ((result.data || []).length !== items.length) throw new Error(`${collection} kunne ikke oprettes.`);
    }

    async function updateItems(collection, items) {
      const table = TABLE_BY_COLLECTION[collection];
      for (const item of items) {
        const result = await client.from(table).update(updateRow(collection, item)).eq("club_id", clubId).eq("id", item.id).select("id");
        if (result.error) throw result.error;
        if (!(result.data || []).length) throw new Error("Posten findes ikke længere. Hent de nyeste data og prøv igen.");
      }
    }

    async function deleteItems(collection, items) {
      if (!items.length) return;
      const table = TABLE_BY_COLLECTION[collection];
      const ids = items.map((item) => item.id);
      const result = await client.from(table).delete().eq("club_id", clubId).in("id", ids);
      if (result.error) throw result.error;
    }

    async function saveSnapshot(previousSource, nextSource) {
      if (!isAdmin) throw new Error("Kun en administrator kan ændre klubbens fælles data.");
      const previous = prepareSnapshot(previousSource);
      const next = prepareSnapshot(nextSource);
      emitSync("syncing", "Gemmer ændringer");
      suppressRealtime = true;
      try {
        const changes = Object.fromEntries(Object.keys(TABLE_BY_COLLECTION).map((collection) => [collection, diff(previous, next, collection)]));
        for (const collection of ["members", "trainings", "messages", "activities"]) {
          await insertItems(collection, changes[collection].added);
          await updateItems(collection, changes[collection].changed);
        }
        for (const collection of ["attendance", "points"]) {
          await insertItems(collection, changes[collection].added);
          await updateItems(collection, changes[collection].changed);
        }
        for (const collection of ["attendance", "points", "trainings", "messages", "activities", "members"]) {
          await deleteItems(collection, changes[collection].removed);
        }
        return await loadSnapshot({ silent: true });
      } catch (error) {
        emitSync("error", error?.message || "Ændringerne kunne ikke gemmes");
        throw error;
      } finally {
        suppressRealtime = false;
      }
    }

    async function replaceSnapshot(nextSource) {
      const current = await loadSnapshot({ silent: true });
      const next = prepareSnapshot(nextSource);
      const linkedMembers = current.data.members.filter((member) => member.userId);
      linkedMembers.forEach((member) => {
        if (!next.members.some((candidate) => candidate.id === member.id || candidate.userId === member.userId)) {
          next.members.push(member);
        }
      });
      return saveSnapshot(current.data, next);
    }

    function leaderboard(mode = "combined") {
      return rankRows(lastMeta?.leaderboardSource || [], mode);
    }

    function todayAttendance(dateKey) {
      const row = (lastMeta?.dailyAttendance || []).find((item) => item.attendance_date === dateKey);
      return row ? {
        present: Number(row.present_count || 0),
        excused: Number(row.excused_count || 0),
        absent: Number(row.absent_count || 0),
        total: Number(row.present_count || 0) + Number(row.excused_count || 0) + Number(row.absent_count || 0),
      } : { present: 0, excused: 0, absent: 0, total: 0 };
    }

    function subscribe(callback) {
      if (channel) return () => channel.unsubscribe();
      const tables = Object.values(TABLE_BY_COLLECTION);
      channel = client.channel(`vsi-club-${clubId}`);
      tables.forEach((table) => {
        channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `club_id=eq.${clubId}` }, () => {
          if (suppressRealtime) return;
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(async () => {
            try {
              callback(await loadSnapshot({ silent: true }));
            } catch {
              // Sync status already reports the failure; keep the current screen intact.
            }
          }, 350);
        });
      });
      channel.subscribe();
      return () => {
        window.clearTimeout(refreshTimer);
        channel?.unsubscribe();
        channel = null;
      };
    }

    return {
      clubId,
      userId,
      isAdmin,
      loadSnapshot,
      saveSnapshot,
      replaceSnapshot,
      prepareSnapshot,
      leaderboard,
      todayAttendance,
      subscribe,
      refresh: () => loadSnapshot(),
      newId: uuid,
      getMeta: () => lastMeta,
    };
  }

  window.VSIRepository = Object.freeze({ create });
})();
