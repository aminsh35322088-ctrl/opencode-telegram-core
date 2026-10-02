// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __hasOwnProp = Object.prototype.hasOwnProperty;
function __accessProp(key) {
  return this[key];
}
var __toESMCache_node;
var __toESMCache_esm;
var __toESM = (mod, isNodeMode, target) => {
  var canCache = mod != null && typeof mod === "object";
  if (canCache) {
    var cache = isNodeMode ? __toESMCache_node ??= new WeakMap : __toESMCache_esm ??= new WeakMap;
    var cached = cache.get(mod);
    if (cached)
      return cached;
  }
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: __accessProp.bind(mod, key),
        enumerable: true
      });
  if (canCache)
    cache.set(mod, to);
  return to;
};
var __toCommonJS = (from) => {
  var entry = (__moduleCache ??= new WeakMap).get(from), desc;
  if (entry)
    return entry;
  entry = __defProp({}, "__esModule", { value: true });
  if (from && typeof from === "object" || typeof from === "function") {
    for (var key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(entry, key))
        __defProp(entry, key, {
          get: __accessProp.bind(from, key),
          enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
        });
  }
  __moduleCache.set(from, entry);
  return entry;
};
var __moduleCache;
var __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports);
var __require = import.meta.require;

// runtime/node_modules/@grammyjs/stream/out/stream.js
var require_stream = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.stream = stream;
  exports.streamApi = streamApi;
  function stream(options = {}) {
    const { defaultDraftIdOffset = (ctx) => 256 * ctx.update.update_id } = options;
    return async (ctx, next) => {
      const { streamMessage: streamMessageApi, streamMarkdown: streamMarkdownApi, streamHtml: streamHtmlApi } = streamApi(ctx.api.raw);
      ctx.api.streamMessage = streamMessageApi;
      ctx.api.streamMarkdown = streamMarkdownApi;
      ctx.api.streamHtml = streamHtmlApi;
      ctx.replyWithStream = async function streamMessage(stream2, otherMessageDraft, otherMessage, signal) {
        const chatId = ctx.chatId;
        if (chatId === undefined) {
          throw new Error("This update does not belong to a chat, so you cannot call 'streamMessage'");
        }
        const msg = ctx.msg;
        const messageThreadId = msg?.is_topic_message ? { message_thread_id: msg.message_thread_id } : {};
        return await streamMessageApi(chatId, defaultDraftIdOffset(ctx), stream2, { ...messageThreadId, ...otherMessageDraft }, { ...messageThreadId, ...otherMessage }, signal);
      };
      ctx.replyWithMarkdownStream = async function streamMarkdown(stream2, otherRichMessageDraft, otherRichMessage, baseInputRichMessage, signal) {
        const chatId = ctx.chatId;
        if (chatId === undefined) {
          throw new Error("This update does not belong to a chat, so you cannot call 'streamMarkdown'");
        }
        const msg = ctx.msg;
        const messageThreadId = msg?.is_topic_message ? { message_thread_id: msg.message_thread_id } : {};
        return await streamMarkdownApi(chatId, ctx.update.update_id, stream2, { ...messageThreadId, ...otherRichMessageDraft }, { ...messageThreadId, ...otherRichMessage }, baseInputRichMessage, signal);
      };
      ctx.replyWithHtmlStream = async function streamHtml(stream2, otherRichMessageDraft, otherRichMessage, baseInputRichMessage, signal) {
        const chatId = ctx.chatId;
        if (chatId === undefined) {
          throw new Error("This update does not belong to a chat, so you cannot call 'streamHtml'");
        }
        const msg = ctx.msg;
        const messageThreadId = msg?.is_topic_message ? { message_thread_id: msg.message_thread_id } : {};
        return await streamHtmlApi(chatId, ctx.update.update_id, stream2, { ...messageThreadId, ...otherRichMessageDraft }, { ...messageThreadId, ...otherRichMessage }, baseInputRichMessage, signal);
      };
      await next();
    };
  }
  function streamApi(rawApi) {
    return {
      streamMessage: async function streamMessage(chat_id, draft_id_offset, stream2, otherMessageDraft, otherMessage, signal) {
        return await streamPlainMessage(chat_id, draft_id_offset, stream2, otherMessageDraft, otherMessage, signal);
      },
      streamMarkdown: async function streamMarkdown(chat_id, draft_id, stream2, otherRichMessageDraft, otherRichMessage, baseInputRichMessage, signal) {
        return await streamRichMessage((markdown) => ({ ...baseInputRichMessage, markdown }), chat_id, draft_id, stream2, otherRichMessageDraft, otherRichMessage, signal);
      },
      streamHtml: async function streamHtml(chat_id, draft_id, stream2, otherRichMessageDraft, otherRichMessage, baseInputRichMessage, signal) {
        return await streamRichMessage((html) => ({ ...baseInputRichMessage, html }), chat_id, draft_id, stream2, otherRichMessageDraft, otherRichMessage, signal);
      }
    };
    async function streamRichMessage(buildInputRichMessage, chat_id, draft_id, stream2, otherRichMessageDraft, otherRichMessage, signal) {
      let latest = undefined;
      let lock = undefined;
      let running = true;
      let exhausted = false;
      async function pull() {
        let accumulator = undefined;
        for await (const draft of stream2) {
          if (!running || signal?.aborted)
            break;
          if (accumulator === undefined) {
            accumulator = draft;
          } else {
            accumulator += draft;
          }
          latest = accumulator;
          if (lock !== undefined) {
            lock.resolve();
            lock = undefined;
          }
        }
        exhausted = true;
        if (lock !== undefined) {
          lock.resolve();
          lock = undefined;
        }
      }
      async function push() {
        let draft = "";
        try {
          while (!exhausted) {
            if (latest !== undefined) {
              draft = latest;
              latest = undefined;
              await rawApi.sendRichMessageDraft({
                chat_id,
                draft_id,
                rich_message: buildInputRichMessage(draft),
                ...otherRichMessageDraft
              }, signal);
              continue;
            }
            lock = Promise.withResolvers();
            await lock.promise;
          }
        } finally {
          running = false;
        }
        if (latest !== undefined) {
          draft = latest;
          latest = undefined;
        }
        return await rawApi.sendRichMessage({
          chat_id,
          rich_message: buildInputRichMessage(draft),
          ...otherRichMessage
        }, signal);
      }
      const [, message] = await Promise.all([pull(), push()]);
      return message;
    }
    async function streamPlainMessage(chat_id, draft_id_offset, stream2, otherMessageDraft, otherMessage, signal) {
      async function* enumerateDrafts() {
        let currentDraftId = 0;
        let currentByteCount = 0;
        let currentNegativeEntityOffset = 0;
        for await (const chunk of stream2) {
          const { draft_id, text, entities = [] } = typeof chunk === "string" ? { text: chunk } : chunk;
          const lastDraftId = currentDraftId;
          const addedLength = text.length;
          if (draft_id !== undefined) {
            currentDraftId = draft_id;
          } else if (currentByteCount + addedLength > 4096) {
            currentDraftId++;
          }
          if (lastDraftId === currentDraftId) {
            currentByteCount += addedLength;
          } else {
            currentNegativeEntityOffset += currentByteCount;
            currentByteCount = addedLength;
          }
          yield {
            id: draft_id_offset + currentDraftId,
            text,
            entities: entities.map((e) => ({
              ...e,
              offset: e.offset - currentNegativeEntityOffset
            }))
          };
        }
      }
      let latest = undefined;
      const complete = [];
      let lock = undefined;
      let running = true;
      let exhausted = false;
      async function pull() {
        let accumulator;
        for await (const draft of enumerateDrafts()) {
          if (!running || signal?.aborted)
            break;
          if (accumulator === undefined) {
            accumulator = draft;
          } else if (accumulator.id === draft.id) {
            accumulator.text += draft.text;
            accumulator.entities = accumulator.entities.concat(draft.entities);
          } else {
            complete.push(accumulator);
            accumulator = draft;
          }
          latest = accumulator;
          if (lock !== undefined) {
            lock.resolve();
            lock = undefined;
          }
        }
        if (accumulator !== undefined) {
          complete.push(accumulator);
        }
        exhausted = true;
        if (lock !== undefined) {
          lock.resolve();
          lock = undefined;
        }
      }
      const messages = [];
      async function push() {
        try {
          while (!exhausted || complete.length > 0) {
            let draft;
            draft = complete.shift();
            if (draft !== undefined) {
              const message = await rawApi.sendMessage({
                chat_id,
                text: draft.text,
                entities: draft.entities,
                ...otherMessage
              }, signal);
              messages.push(message);
              continue;
            }
            draft = latest;
            if (draft !== undefined) {
              latest = undefined;
              await rawApi.sendMessageDraft({
                chat_id,
                draft_id: draft.id,
                text: draft.text,
                entities: draft.entities,
                ...otherMessageDraft
              }, signal);
              continue;
            }
            lock = Promise.withResolvers();
            await lock.promise;
          }
        } finally {
          running = false;
        }
      }
      await Promise.all([pull(), push()]);
      return messages;
    }
  }
});

// runtime/node_modules/@grammyjs/stream/out/mod.js
var require_mod = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  __exportStar(require_stream(), exports);
});

// runtime/node_modules/grammy/out/filter.js
var require_filter = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.matchFilter = matchFilter;
  exports.parse = parse;
  exports.preprocess = preprocess;
  var filterQueryCache = new Map;
  function matchFilter(filter) {
    var _a;
    const queries = Array.isArray(filter) ? filter : [filter];
    const key = queries.join(",");
    const predicate = (_a = filterQueryCache.get(key)) !== null && _a !== undefined ? _a : (() => {
      const parsed = parse(queries);
      const pred = compile(parsed);
      filterQueryCache.set(key, pred);
      return pred;
    })();
    return (ctx) => predicate(ctx);
  }
  function parse(filter) {
    return Array.isArray(filter) ? filter.map((q) => q.split(":")) : [filter.split(":")];
  }
  function compile(parsed) {
    const preprocessed = parsed.flatMap((q) => check(q, preprocess(q)));
    const ltree = treeify(preprocessed);
    const predicate = arborist(ltree);
    return (ctx) => !!predicate(ctx.update, ctx);
  }
  function preprocess(filter) {
    const valid = UPDATE_KEYS;
    const expanded = [filter].flatMap((q) => {
      const [l1, l2, l3] = q;
      if (!(l1 in L1_SHORTCUTS))
        return [q];
      if (!l1 && !l2 && !l3)
        return [q];
      const targets = L1_SHORTCUTS[l1];
      const expanded2 = targets.map((s) => [s, l2, l3]);
      if (l2 === undefined)
        return expanded2;
      if (l2 in L2_SHORTCUTS && (l2 || l3))
        return expanded2;
      return expanded2.filter(([s]) => {
        var _a;
        return !!((_a = valid[s]) === null || _a === undefined ? undefined : _a[l2]);
      });
    }).flatMap((q) => {
      const [l1, l2, l3] = q;
      if (!(l2 in L2_SHORTCUTS))
        return [q];
      if (!l2 && !l3)
        return [q];
      const targets = L2_SHORTCUTS[l2];
      const expanded2 = targets.map((s) => [l1, s, l3]);
      if (l3 === undefined)
        return expanded2;
      return expanded2.filter(([, s]) => {
        var _a, _b;
        return !!((_b = (_a = valid[l1]) === null || _a === undefined ? undefined : _a[s]) === null || _b === undefined ? undefined : _b[l3]);
      });
    });
    if (expanded.length === 0) {
      throw new Error(`Shortcuts in '${filter.join(":")}' do not expand to any valid filter query`);
    }
    return expanded;
  }
  function check(original, preprocessed) {
    if (preprocessed.length === 0)
      throw new Error("Empty filter query given");
    const errors = preprocessed.map(checkOne).filter((r) => r !== true);
    if (errors.length === 0)
      return preprocessed;
    else if (errors.length === 1)
      throw new Error(errors[0]);
    else {
      throw new Error(`Invalid filter query '${original.join(":")}'. There are ${errors.length} errors after expanding the contained shortcuts: ${errors.join("; ")}`);
    }
  }
  function checkOne(filter) {
    const [l1, l2, l3, ...n] = filter;
    if (l1 === undefined)
      return "Empty filter query given";
    if (!(l1 in UPDATE_KEYS)) {
      const permitted = Object.keys(UPDATE_KEYS);
      return `Invalid L1 filter '${l1}' given in '${filter.join(":")}'. Permitted values are: ${permitted.map((k) => `'${k}'`).join(", ")}.`;
    }
    if (l2 === undefined)
      return true;
    const l1Obj = UPDATE_KEYS[l1];
    if (!(l2 in l1Obj)) {
      const permitted = Object.keys(l1Obj);
      return `Invalid L2 filter '${l2}' given in '${filter.join(":")}'. Permitted values are: ${permitted.map((k) => `'${k}'`).join(", ")}.`;
    }
    if (l3 === undefined)
      return true;
    const l2Obj = l1Obj[l2];
    if (!(l3 in l2Obj)) {
      const permitted = Object.keys(l2Obj);
      return `Invalid L3 filter '${l3}' given in '${filter.join(":")}'. ${permitted.length === 0 ? `No further filtering is possible after '${l1}:${l2}'.` : `Permitted values are: ${permitted.map((k) => `'${k}'`).join(", ")}.`}`;
    }
    if (n.length === 0)
      return true;
    return `Cannot filter further than three levels, ':${n.join(":")}' is invalid!`;
  }
  function treeify(paths) {
    var _a, _b;
    const tree = {};
    for (const [l1, l2, l3] of paths) {
      const subtree = (_a = tree[l1]) !== null && _a !== undefined ? _a : tree[l1] = {};
      if (l2 !== undefined) {
        const set = (_b = subtree[l2]) !== null && _b !== undefined ? _b : subtree[l2] = new Set;
        if (l3 !== undefined)
          set.add(l3);
      }
    }
    return tree;
  }
  function or(left, right) {
    return (obj, ctx) => left(obj, ctx) || right(obj, ctx);
  }
  function concat(get, test) {
    return (obj, ctx) => {
      const nextObj = get(obj, ctx);
      return nextObj && test(nextObj, ctx);
    };
  }
  function leaf(pred) {
    return (obj, ctx) => pred(obj, ctx) != null;
  }
  function arborist(tree) {
    const l1Predicates = Object.entries(tree).map(([l1, subtree]) => {
      const l1Pred = (obj) => obj[l1];
      const l2Predicates = Object.entries(subtree).map(([l2, set]) => {
        const l2Pred = (obj) => obj[l2];
        const l3Predicates = Array.from(set).map((l3) => {
          const l3Pred = l3 === "me" ? (obj, ctx) => {
            const me = ctx.me.id;
            return testMaybeArray(obj, (u) => u.id === me);
          } : (obj) => testMaybeArray(obj, (e) => e[l3] || e.type === l3);
          return l3Pred;
        });
        return l3Predicates.length === 0 ? leaf(l2Pred) : concat(l2Pred, l3Predicates.reduce(or));
      });
      return l2Predicates.length === 0 ? leaf(l1Pred) : concat(l1Pred, l2Predicates.reduce(or));
    });
    if (l1Predicates.length === 0) {
      throw new Error("Cannot create filter function for empty query");
    }
    return l1Predicates.reduce(or);
  }
  function testMaybeArray(t, pred) {
    const p = (x) => x != null && pred(x);
    return Array.isArray(t) ? t.some(p) : p(t);
  }
  var ENTITY_KEYS = {
    mention: {},
    hashtag: {},
    cashtag: {},
    bot_command: {},
    url: {},
    email: {},
    phone_number: {},
    bold: {},
    italic: {},
    underline: {},
    strikethrough: {},
    spoiler: {},
    blockquote: {},
    expandable_blockquote: {},
    code: {},
    pre: {},
    text_link: {},
    text_mention: {},
    custom_emoji: {},
    date_time: {}
  };
  var USER_KEYS = {
    me: {},
    is_bot: {},
    is_premium: {},
    added_to_attachment_menu: {}
  };
  var FORWARD_ORIGIN_KEYS = {
    user: {},
    hidden_user: {},
    chat: {},
    channel: {}
  };
  var STICKER_KEYS = {
    is_video: {},
    is_animated: {},
    premium_animation: {}
  };
  var REACTION_KEYS = {
    emoji: {},
    custom_emoji: {},
    paid: {}
  };
  var GIFT_INFO_KEYS = {
    can_be_upgraded: {},
    is_upgrade_separate: {},
    is_private: {}
  };
  var COMMON_MESSAGE_KEYS = {
    forward_origin: FORWARD_ORIGIN_KEYS,
    is_topic_message: {},
    is_automatic_forward: {},
    guest_query_id: {},
    business_connection_id: {},
    text: {},
    rich_message: {},
    animation: {},
    audio: {},
    document: {},
    live_photo: {},
    paid_media: {},
    photo: {},
    sticker: STICKER_KEYS,
    story: {},
    video: {},
    video_note: {},
    voice: {},
    contact: {},
    dice: {},
    game: {},
    poll: {},
    venue: {},
    location: {},
    entities: ENTITY_KEYS,
    caption_entities: ENTITY_KEYS,
    caption: {},
    link_preview_options: {
      url: {},
      prefer_small_media: {},
      prefer_large_media: {},
      show_above_text: {}
    },
    effect_id: {},
    paid_star_count: {},
    has_media_spoiler: {},
    new_chat_title: {},
    new_chat_photo: {},
    delete_chat_photo: {},
    message_auto_delete_timer_changed: {},
    pinned_message: {},
    invoice: {},
    proximity_alert_triggered: {},
    chat_background_set: {},
    giveaway_created: {},
    giveaway: { only_new_members: {}, has_public_winners: {} },
    giveaway_winners: { only_new_members: {}, was_refunded: {} },
    giveaway_completed: {},
    gift: GIFT_INFO_KEYS,
    gift_upgrade_sent: GIFT_INFO_KEYS,
    unique_gift: { transfer_star_count: {}, text: {}, is_private: {} },
    paid_message_price_changed: {},
    video_chat_scheduled: {},
    video_chat_started: {},
    video_chat_ended: {},
    video_chat_participants_invited: {},
    web_app_data: {}
  };
  var MESSAGE_KEYS = {
    ...COMMON_MESSAGE_KEYS,
    direct_messages_topic: {},
    chat_owner_left: { new_owner: {} },
    chat_owner_changed: {},
    new_chat_members: USER_KEYS,
    community_chat_joined: {},
    left_chat_member: USER_KEYS,
    group_chat_created: {},
    supergroup_chat_created: {},
    migrate_to_chat_id: {},
    migrate_from_chat_id: {},
    successful_payment: {},
    refunded_payment: {},
    users_shared: {},
    chat_shared: {},
    connected_website: {},
    managed_bot_created: {},
    write_access_allowed: {},
    passport_data: {},
    boost_added: {},
    forum_topic_created: { is_name_implicit: {} },
    forum_topic_edited: { name: {}, icon_custom_emoji_id: {} },
    forum_topic_closed: {},
    forum_topic_reopened: {},
    general_forum_topic_hidden: {},
    general_forum_topic_unhidden: {},
    checklist: { others_can_add_tasks: {}, others_can_mark_tasks_as_done: {} },
    checklist_tasks_done: {},
    checklist_tasks_added: {},
    community_chat_added: {},
    community_chat_removed: {},
    poll_option_added: {},
    poll_option_deleted: {},
    suggested_post_info: {},
    suggested_post_approved: {},
    suggested_post_approval_failed: {},
    suggested_post_declined: {},
    suggested_post_paid: {},
    suggested_post_refunded: {},
    sender_boost_count: {}
  };
  var CHANNEL_POST_KEYS = {
    ...COMMON_MESSAGE_KEYS,
    channel_chat_created: {},
    direct_message_price_changed: {},
    is_paid_post: {}
  };
  var BUSINESS_CONNECTION_KEYS = {
    can_reply: {},
    is_enabled: {}
  };
  var MESSAGE_REACTION_KEYS = {
    old_reaction: REACTION_KEYS,
    new_reaction: REACTION_KEYS
  };
  var MESSAGE_REACTION_COUNT_UPDATED_KEYS = {
    reactions: REACTION_KEYS
  };
  var CALLBACK_QUERY_KEYS = { data: {}, game_short_name: {} };
  var CHAT_MEMBER_UPDATED_KEYS = { from: USER_KEYS };
  var UPDATE_KEYS = {
    message: MESSAGE_KEYS,
    edited_message: MESSAGE_KEYS,
    channel_post: CHANNEL_POST_KEYS,
    edited_channel_post: CHANNEL_POST_KEYS,
    business_connection: BUSINESS_CONNECTION_KEYS,
    business_message: MESSAGE_KEYS,
    edited_business_message: MESSAGE_KEYS,
    deleted_business_messages: {},
    guest_message: MESSAGE_KEYS,
    stopped_message_generation: {},
    inline_query: {},
    chosen_inline_result: {},
    callback_query: CALLBACK_QUERY_KEYS,
    shipping_query: {},
    pre_checkout_query: {},
    poll: {},
    poll_answer: {},
    my_chat_member: CHAT_MEMBER_UPDATED_KEYS,
    chat_member: CHAT_MEMBER_UPDATED_KEYS,
    managed_bot: {},
    chat_join_request: {},
    message_reaction: MESSAGE_REACTION_KEYS,
    message_reaction_count: MESSAGE_REACTION_COUNT_UPDATED_KEYS,
    chat_boost: {},
    removed_chat_boost: {},
    purchased_paid_media: {},
    subscription: { state: { canceled: {}, active: {}, failed: {} } }
  };
  var L1_SHORTCUTS = {
    "": ["message", "channel_post"],
    msg: ["message", "channel_post"],
    edit: ["edited_message", "edited_channel_post"]
  };
  var L2_SHORTCUTS = {
    "": ["entities", "caption_entities"],
    media: ["photo", "live_photo", "video"],
    file: [
      "photo",
      "live_photo",
      "animation",
      "audio",
      "document",
      "video",
      "video_note",
      "voice",
      "sticker"
    ]
  };
});

// runtime/node_modules/grammy/out/context.js
var require_context = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Context = undefined;
  var filter_js_1 = require_filter();
  var checker = {
    filterQuery(filter) {
      const pred = (0, filter_js_1.matchFilter)(filter);
      return (ctx) => pred(ctx);
    },
    text(trigger) {
      const hasText = checker.filterQuery([":text", ":caption"]);
      const trg = triggerFn(trigger);
      return (ctx) => {
        var _a, _b;
        if (!hasText(ctx))
          return false;
        const msg = (_a = ctx.message) !== null && _a !== undefined ? _a : ctx.channelPost;
        const txt = (_b = msg.text) !== null && _b !== undefined ? _b : msg.caption;
        return match(ctx, txt, trg);
      };
    },
    command(command) {
      const hasEntities = checker.filterQuery(":entities:bot_command");
      const atCommands = new Set;
      const noAtCommands = new Set;
      toArray(command).forEach((cmd) => {
        if (cmd.startsWith("/")) {
          throw new Error(`Do not include '/' when registering command handlers (use '${cmd.substring(1)}' not '${cmd}')`);
        }
        const set = cmd.includes("@") ? atCommands : noAtCommands;
        set.add(cmd);
      });
      return (ctx) => {
        var _a, _b;
        if (!hasEntities(ctx))
          return false;
        const msg = (_a = ctx.message) !== null && _a !== undefined ? _a : ctx.channelPost;
        const txt = (_b = msg.text) !== null && _b !== undefined ? _b : msg.caption;
        return msg.entities.some((e) => {
          if (e.type !== "bot_command")
            return false;
          if (e.offset !== 0)
            return false;
          const cmd = txt.substring(1, e.length);
          if (noAtCommands.has(cmd) || atCommands.has(cmd)) {
            ctx.match = txt.substring(cmd.length + 1).trimStart();
            return true;
          }
          const index = cmd.indexOf("@");
          if (index === -1)
            return false;
          const atTarget = cmd.substring(index + 1).toLowerCase();
          const username = ctx.me.username.toLowerCase();
          if (atTarget !== username)
            return false;
          const atCommand = cmd.substring(0, index);
          if (noAtCommands.has(atCommand)) {
            ctx.match = txt.substring(cmd.length + 1).trimStart();
            return true;
          }
          return false;
        });
      };
    },
    reaction(reaction) {
      const hasMessageReaction = checker.filterQuery("message_reaction");
      const normalized = typeof reaction === "string" ? [{ type: "emoji", emoji: reaction }] : (Array.isArray(reaction) ? reaction : [reaction]).map((emoji2) => typeof emoji2 === "string" ? { type: "emoji", emoji: emoji2 } : emoji2);
      const emoji = new Set(normalized.filter((r) => r.type === "emoji").map((r) => r.emoji));
      const customEmoji = new Set(normalized.filter((r) => r.type === "custom_emoji").map((r) => r.custom_emoji_id));
      const paid = normalized.some((r) => r.type === "paid");
      return (ctx) => {
        if (!hasMessageReaction(ctx))
          return false;
        const { old_reaction, new_reaction } = ctx.messageReaction;
        for (const reaction2 of new_reaction) {
          let isOld = false;
          if (reaction2.type === "emoji") {
            for (const old of old_reaction) {
              if (old.type !== "emoji")
                continue;
              if (old.emoji === reaction2.emoji) {
                isOld = true;
                break;
              }
            }
          } else if (reaction2.type === "custom_emoji") {
            for (const old of old_reaction) {
              if (old.type !== "custom_emoji")
                continue;
              if (old.custom_emoji_id === reaction2.custom_emoji_id) {
                isOld = true;
                break;
              }
            }
          } else if (reaction2.type === "paid") {
            for (const old of old_reaction) {
              if (old.type !== "paid")
                continue;
              isOld = true;
              break;
            }
          }
          if (isOld)
            continue;
          if (reaction2.type === "emoji") {
            if (emoji.has(reaction2.emoji))
              return true;
          } else if (reaction2.type === "custom_emoji") {
            if (customEmoji.has(reaction2.custom_emoji_id))
              return true;
          } else if (reaction2.type === "paid") {
            if (paid)
              return true;
          } else {
            return true;
          }
        }
        return false;
      };
    },
    chatType(chatType) {
      const set = new Set(toArray(chatType));
      return (ctx) => {
        var _a;
        return ((_a = ctx.chat) === null || _a === undefined ? undefined : _a.type) !== undefined && set.has(ctx.chat.type);
      };
    },
    callbackQuery(trigger) {
      const hasCallbackQuery = checker.filterQuery("callback_query:data");
      const trg = triggerFn(trigger);
      return (ctx) => hasCallbackQuery(ctx) && match(ctx, ctx.callbackQuery.data, trg);
    },
    gameQuery(trigger) {
      const hasGameQuery = checker.filterQuery("callback_query:game_short_name");
      const trg = triggerFn(trigger);
      return (ctx) => hasGameQuery(ctx) && match(ctx, ctx.callbackQuery.game_short_name, trg);
    },
    inlineQuery(trigger) {
      const hasInlineQuery = checker.filterQuery("inline_query");
      const trg = triggerFn(trigger);
      return (ctx) => hasInlineQuery(ctx) && match(ctx, ctx.inlineQuery.query, trg);
    },
    chosenInlineResult(trigger) {
      const hasChosenInlineResult = checker.filterQuery("chosen_inline_result");
      const trg = triggerFn(trigger);
      return (ctx) => hasChosenInlineResult(ctx) && match(ctx, ctx.chosenInlineResult.result_id, trg);
    },
    preCheckoutQuery(trigger) {
      const hasPreCheckoutQuery = checker.filterQuery("pre_checkout_query");
      const trg = triggerFn(trigger);
      return (ctx) => hasPreCheckoutQuery(ctx) && match(ctx, ctx.preCheckoutQuery.invoice_payload, trg);
    },
    shippingQuery(trigger) {
      const hasShippingQuery = checker.filterQuery("shipping_query");
      const trg = triggerFn(trigger);
      return (ctx) => hasShippingQuery(ctx) && match(ctx, ctx.shippingQuery.invoice_payload, trg);
    }
  };

  class Context {
    constructor(update, api, me) {
      this.update = update;
      this.api = api;
      this.me = me;
    }
    get message() {
      return this.update.message;
    }
    get editedMessage() {
      return this.update.edited_message;
    }
    get channelPost() {
      return this.update.channel_post;
    }
    get editedChannelPost() {
      return this.update.edited_channel_post;
    }
    get businessConnection() {
      return this.update.business_connection;
    }
    get businessMessage() {
      return this.update.business_message;
    }
    get editedBusinessMessage() {
      return this.update.edited_business_message;
    }
    get deletedBusinessMessages() {
      return this.update.deleted_business_messages;
    }
    get guestMessage() {
      return this.update.guest_message;
    }
    get stoppedMessageGeneration() {
      return this.update.stopped_message_generation;
    }
    get messageReaction() {
      return this.update.message_reaction;
    }
    get messageReactionCount() {
      return this.update.message_reaction_count;
    }
    get inlineQuery() {
      return this.update.inline_query;
    }
    get chosenInlineResult() {
      return this.update.chosen_inline_result;
    }
    get callbackQuery() {
      return this.update.callback_query;
    }
    get shippingQuery() {
      return this.update.shipping_query;
    }
    get preCheckoutQuery() {
      return this.update.pre_checkout_query;
    }
    get poll() {
      return this.update.poll;
    }
    get pollAnswer() {
      return this.update.poll_answer;
    }
    get myChatMember() {
      return this.update.my_chat_member;
    }
    get chatMember() {
      return this.update.chat_member;
    }
    get managedBot() {
      return this.update.managed_bot;
    }
    get chatJoinRequest() {
      return this.update.chat_join_request;
    }
    get chatBoost() {
      return this.update.chat_boost;
    }
    get removedChatBoost() {
      return this.update.removed_chat_boost;
    }
    get purchasedPaidMedia() {
      return this.update.purchased_paid_media;
    }
    get subscription() {
      return this.update.subscription;
    }
    get msg() {
      var _a, _b, _c, _d, _e, _f, _g, _h;
      return (_g = (_f = (_e = (_d = (_c = (_b = (_a = this.message) !== null && _a !== undefined ? _a : this.editedMessage) !== null && _b !== undefined ? _b : this.channelPost) !== null && _c !== undefined ? _c : this.editedChannelPost) !== null && _d !== undefined ? _d : this.businessMessage) !== null && _e !== undefined ? _e : this.editedBusinessMessage) !== null && _f !== undefined ? _f : this.guestMessage) !== null && _g !== undefined ? _g : (_h = this.callbackQuery) === null || _h === undefined ? undefined : _h.message;
    }
    get chat() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
      return (_k = (_j = (_h = (_g = (_f = (_e = (_d = (_c = (_b = (_a = this.msg) !== null && _a !== undefined ? _a : this.deletedBusinessMessages) !== null && _b !== undefined ? _b : this.stoppedMessageGeneration) !== null && _c !== undefined ? _c : this.messageReaction) !== null && _d !== undefined ? _d : this.messageReactionCount) !== null && _e !== undefined ? _e : this.myChatMember) !== null && _f !== undefined ? _f : this.chatMember) !== null && _g !== undefined ? _g : this.chatJoinRequest) !== null && _h !== undefined ? _h : this.chatBoost) !== null && _j !== undefined ? _j : this.removedChatBoost) === null || _k === undefined ? undefined : _k.chat;
    }
    get senderChat() {
      var _a;
      return (_a = this.msg) === null || _a === undefined ? undefined : _a.sender_chat;
    }
    get from() {
      var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u;
      return (_j = (_h = (_g = (_c = (_b = (_a = this.businessConnection) !== null && _a !== undefined ? _a : this.messageReaction) !== null && _b !== undefined ? _b : this.managedBot) !== null && _c !== undefined ? _c : (_f = (_e = (_d = this.chatBoost) === null || _d === undefined ? undefined : _d.boost) !== null && _e !== undefined ? _e : this.removedChatBoost) === null || _f === undefined ? undefined : _f.source) !== null && _g !== undefined ? _g : this.subscription) === null || _h === undefined ? undefined : _h.user) !== null && _j !== undefined ? _j : (_u = (_t = (_s = (_r = (_q = (_p = (_o = (_m = (_l = (_k = this.callbackQuery) !== null && _k !== undefined ? _k : this.msg) !== null && _l !== undefined ? _l : this.inlineQuery) !== null && _m !== undefined ? _m : this.chosenInlineResult) !== null && _o !== undefined ? _o : this.shippingQuery) !== null && _p !== undefined ? _p : this.preCheckoutQuery) !== null && _q !== undefined ? _q : this.myChatMember) !== null && _r !== undefined ? _r : this.chatMember) !== null && _s !== undefined ? _s : this.chatJoinRequest) !== null && _t !== undefined ? _t : this.purchasedPaidMedia) === null || _u === undefined ? undefined : _u.from;
    }
    get msgId() {
      var _a, _b, _c, _d, _e;
      return (_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id;
    }
    get chatId() {
      var _a, _b, _c;
      return (_b = (_a = this.chat) === null || _a === undefined ? undefined : _a.id) !== null && _b !== undefined ? _b : (_c = this.businessConnection) === null || _c === undefined ? undefined : _c.user_chat_id;
    }
    get inlineMessageId() {
      var _a, _b, _c;
      return (_b = (_a = this.callbackQuery) === null || _a === undefined ? undefined : _a.inline_message_id) !== null && _b !== undefined ? _b : (_c = this.chosenInlineResult) === null || _c === undefined ? undefined : _c.inline_message_id;
    }
    get businessConnectionId() {
      var _a, _b, _c, _d, _e;
      return (_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.business_connection_id) !== null && _b !== undefined ? _b : (_c = this.businessConnection) === null || _c === undefined ? undefined : _c.id) !== null && _d !== undefined ? _d : (_e = this.deletedBusinessMessages) === null || _e === undefined ? undefined : _e.business_connection_id;
    }
    entities(types) {
      var _a, _b;
      const message = this.msg;
      if (message === undefined)
        return [];
      const text = (_a = message.text) !== null && _a !== undefined ? _a : message.caption;
      if (text === undefined)
        return [];
      let entities = (_b = message.entities) !== null && _b !== undefined ? _b : message.caption_entities;
      if (entities === undefined)
        return [];
      if (types !== undefined) {
        const filters = new Set(toArray(types));
        entities = entities.filter((entity) => filters.has(entity.type));
      }
      return entities.map((entity) => ({
        ...entity,
        text: text.substring(entity.offset, entity.offset + entity.length)
      }));
    }
    reactions() {
      const emoji = [];
      const emojiAdded = [];
      const emojiKept = [];
      const emojiRemoved = [];
      const customEmoji = [];
      const customEmojiAdded = [];
      const customEmojiKept = [];
      const customEmojiRemoved = [];
      let paid = false;
      let paidAdded = false;
      const r = this.messageReaction;
      if (r !== undefined) {
        const { old_reaction, new_reaction } = r;
        for (const reaction of new_reaction) {
          if (reaction.type === "emoji") {
            emoji.push(reaction.emoji);
          } else if (reaction.type === "custom_emoji") {
            customEmoji.push(reaction.custom_emoji_id);
          } else if (reaction.type === "paid") {
            paid = paidAdded = true;
          }
        }
        for (const reaction of old_reaction) {
          if (reaction.type === "emoji") {
            emojiRemoved.push(reaction.emoji);
          } else if (reaction.type === "custom_emoji") {
            customEmojiRemoved.push(reaction.custom_emoji_id);
          } else if (reaction.type === "paid") {
            paidAdded = false;
          }
        }
        emojiAdded.push(...emoji);
        customEmojiAdded.push(...customEmoji);
        for (let i = 0;i < emojiRemoved.length; i++) {
          const len = emojiAdded.length;
          if (len === 0)
            break;
          const rem = emojiRemoved[i];
          for (let j = 0;j < len; j++) {
            if (rem === emojiAdded[j]) {
              emojiKept.push(rem);
              emojiRemoved.splice(i, 1);
              emojiAdded.splice(j, 1);
              i--;
              break;
            }
          }
        }
        for (let i = 0;i < customEmojiRemoved.length; i++) {
          const len = customEmojiAdded.length;
          if (len === 0)
            break;
          const rem = customEmojiRemoved[i];
          for (let j = 0;j < len; j++) {
            if (rem === customEmojiAdded[j]) {
              customEmojiKept.push(rem);
              customEmojiRemoved.splice(i, 1);
              customEmojiAdded.splice(j, 1);
              i--;
              break;
            }
          }
        }
      }
      return {
        emoji,
        emojiAdded,
        emojiKept,
        emojiRemoved,
        customEmoji,
        customEmojiAdded,
        customEmojiKept,
        customEmojiRemoved,
        paid,
        paidAdded
      };
    }
    has(filter) {
      return Context.has.filterQuery(filter)(this);
    }
    hasText(trigger) {
      return Context.has.text(trigger)(this);
    }
    hasCommand(command) {
      return Context.has.command(command)(this);
    }
    hasReaction(reaction) {
      return Context.has.reaction(reaction)(this);
    }
    hasChatType(chatType) {
      return Context.has.chatType(chatType)(this);
    }
    hasCallbackQuery(trigger) {
      return Context.has.callbackQuery(trigger)(this);
    }
    hasGameQuery(trigger) {
      return Context.has.gameQuery(trigger)(this);
    }
    hasInlineQuery(trigger) {
      return Context.has.inlineQuery(trigger)(this);
    }
    hasChosenInlineResult(trigger) {
      return Context.has.chosenInlineResult(trigger)(this);
    }
    hasPreCheckoutQuery(trigger) {
      return Context.has.preCheckoutQuery(trigger)(this);
    }
    hasShippingQuery(trigger) {
      return Context.has.shippingQuery(trigger)(this);
    }
    reply(text, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendMessage(orThrow(this.chatId, "sendMessage"), text, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithRichMessage(rich_message, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendRichMessage(orThrow(this.chatId, "sendRichMessage"), rich_message, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    forwardMessage(chat_id, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.forwardMessage(chat_id, orThrow(this.chatId, "forwardMessage"), orThrow(this.msgId, "forwardMessage"), {
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    forwardMessages(chat_id, message_ids, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.forwardMessages(chat_id, orThrow(this.chatId, "forwardMessages"), message_ids, {
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    copyMessage(chat_id, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.copyMessage(chat_id, orThrow(this.chatId, "copyMessage"), orThrow(this.msgId, "copyMessage"), {
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    copyMessages(chat_id, message_ids, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.copyMessages(chat_id, orThrow(this.chatId, "copyMessages"), message_ids, {
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithPhoto(photo, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendPhoto(orThrow(this.chatId, "sendPhoto"), photo, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithLivePhoto(live_photo, photo, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendLivePhoto(orThrow(this.chatId, "sendLivePhoto"), live_photo, photo, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithAudio(audio, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendAudio(orThrow(this.chatId, "sendAudio"), audio, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithDocument(document2, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendDocument(orThrow(this.chatId, "sendDocument"), document2, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithVideo(video, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendVideo(orThrow(this.chatId, "sendVideo"), video, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithAnimation(animation, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendAnimation(orThrow(this.chatId, "sendAnimation"), animation, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithVoice(voice, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendVoice(orThrow(this.chatId, "sendVoice"), voice, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithVideoNote(video_note, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendVideoNote(orThrow(this.chatId, "sendVideoNote"), video_note, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    sendPaidMedia(...args) {
      return this.replyWithPaidMedia(...args);
    }
    replyWithPaidMedia(star_count, media, other, signal) {
      var _a, _b;
      const msg = this.msg;
      return this.api.sendPaidMedia(orThrow(this.chatId, "sendPaidMedia"), star_count, media, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.direct_messages_topic) === null || _b === undefined ? undefined : _b.topic_id,
        ...other
      }, signal);
    }
    replyWithMediaGroup(media, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendMediaGroup(orThrow(this.chatId, "sendMediaGroup"), media, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithLocation(latitude, longitude, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendLocation(orThrow(this.chatId, "sendLocation"), latitude, longitude, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    editMessageLiveLocation(latitude, longitude, other, signal) {
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.editMessageLiveLocationInline(inlineId, latitude, longitude, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.editMessageLiveLocation(orThrow(this.chatId, "editMessageLiveLocation"), orThrow(this.msgId, "editMessageLiveLocation"), latitude, longitude, { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    stopMessageLiveLocation(other, signal) {
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.stopMessageLiveLocationInline(inlineId, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.stopMessageLiveLocation(orThrow(this.chatId, "stopMessageLiveLocation"), orThrow(this.msgId, "stopMessageLiveLocation"), { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    replyWithVenue(latitude, longitude, title, address, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendVenue(orThrow(this.chatId, "sendVenue"), latitude, longitude, title, address, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithContact(phone_number, first_name, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendContact(orThrow(this.chatId, "sendContact"), phone_number, first_name, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithPoll(question, options, other, signal) {
      const msg = this.msg;
      return this.api.sendPoll(orThrow(this.chatId, "sendPoll"), question, options, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        ...other
      }, signal);
    }
    replyWithChecklist(checklist, other, signal) {
      return this.api.sendChecklist(orThrow(this.businessConnectionId, "sendChecklist"), orThrow(this.chatId, "sendChecklist"), checklist, other, signal);
    }
    editMessageChecklist(checklist, other, signal) {
      var _a, _b, _c, _d;
      const msg = orThrow(this.msg, "editMessageChecklist");
      const target = (_d = (_b = (_a = msg.checklist_tasks_done) === null || _a === undefined ? undefined : _a.checklist_message) !== null && _b !== undefined ? _b : (_c = msg.checklist_tasks_added) === null || _c === undefined ? undefined : _c.checklist_message) !== null && _d !== undefined ? _d : msg;
      return this.api.editMessageChecklist(orThrow(this.businessConnectionId, "editMessageChecklist"), orThrow(target.chat.id, "editMessageChecklist"), orThrow(target.message_id, "editMessageChecklist"), checklist, other, signal);
    }
    replyWithDice(emoji, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendDice(orThrow(this.chatId, "sendDice"), emoji, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    replyWithChatAction(action, other, signal) {
      const msg = this.msg;
      return this.api.sendChatAction(orThrow(this.chatId, "sendChatAction"), action, {
        business_connection_id: this.businessConnectionId,
        message_thread_id: msg === null || msg === undefined ? undefined : msg.message_thread_id,
        ...other
      }, signal);
    }
    react(reaction, other, signal) {
      return this.api.setMessageReaction(orThrow(this.chatId, "setMessageReaction"), orThrow(this.msgId, "setMessageReaction"), typeof reaction === "string" ? [{ type: "emoji", emoji: reaction }] : (Array.isArray(reaction) ? reaction : [reaction]).map((emoji) => typeof emoji === "string" ? { type: "emoji", emoji } : emoji), other, signal);
    }
    replyWithDraft(text, other, signal) {
      const msg = this.msg;
      return this.api.sendMessageDraft(orThrow(this.chatId, "sendMessageDraft"), this.update.update_id, text, {
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        ...other
      }, signal);
    }
    replyWithRichMessageDraft(rich_message, other, signal) {
      const msg = this.msg;
      return this.api.sendRichMessageDraft(orThrow(this.chatId, "sendMessageDraft"), this.update.update_id, rich_message, {
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        ...other
      }, signal);
    }
    getUserProfilePhotos(other, signal) {
      return this.api.getUserProfilePhotos(orThrow(this.from, "getUserProfilePhotos").id, other, signal);
    }
    getUserProfileAudios(other, signal) {
      return this.api.getUserProfileAudios(orThrow(this.from, "getUserProfileAudios").id, other, signal);
    }
    setUserEmojiStatus(other, signal) {
      return this.api.setUserEmojiStatus(orThrow(this.from, "setUserEmojiStatus").id, other, signal);
    }
    getUserChatBoosts(chat_id, signal) {
      return this.api.getUserChatBoosts(chat_id !== null && chat_id !== undefined ? chat_id : orThrow(this.chatId, "getUserChatBoosts"), orThrow(this.from, "getUserChatBoosts").id, signal);
    }
    getUserGifts(other, signal) {
      return this.api.getUserGifts(orThrow(this.from, "getUserGifts").id, other, signal);
    }
    getChatGifts(other, signal) {
      return this.api.getChatGifts(orThrow(this.chatId, "getChatGifts"), other, signal);
    }
    getBusinessConnection(signal) {
      return this.api.getBusinessConnection(orThrow(this.businessConnectionId, "getBusinessConnection"), signal);
    }
    getManagedBotToken(signal) {
      return this.api.getManagedBotToken(orThrow(this.managedBot, "getManagedBotToken").bot.id, signal);
    }
    replaceManagedBotToken(signal) {
      return this.api.replaceManagedBotToken(orThrow(this.managedBot, "getManagedBotToken").bot.id, signal);
    }
    getManagedBotAccessSettings(signal) {
      return this.api.getManagedBotAccessSettings(orThrow(this.managedBot, "getManagedBotAccessSettings").bot.id, signal);
    }
    setManagedBotAccessSettings(is_access_restricted, other, signal) {
      return this.api.setManagedBotAccessSettings(orThrow(this.managedBot, "setManagedBotAccessSettings").bot.id, is_access_restricted, other, signal);
    }
    getFile(signal) {
      var _a, _b, _c, _d, _e, _f;
      const m = orThrow(this.msg, "getFile");
      const file = m.photo !== undefined ? m.photo[m.photo.length - 1] : (_f = (_e = (_d = (_c = (_b = (_a = m.animation) !== null && _a !== undefined ? _a : m.audio) !== null && _b !== undefined ? _b : m.document) !== null && _c !== undefined ? _c : m.video) !== null && _d !== undefined ? _d : m.video_note) !== null && _e !== undefined ? _e : m.voice) !== null && _f !== undefined ? _f : m.sticker;
      return this.api.getFile(orThrow(file, "getFile").file_id, signal);
    }
    kickAuthor(...args) {
      return this.banAuthor(...args);
    }
    banAuthor(other, signal) {
      return this.api.banChatMember(orThrow(this.chatId, "banAuthor"), orThrow(this.from, "banAuthor").id, other, signal);
    }
    kickChatMember(...args) {
      return this.banChatMember(...args);
    }
    banChatMember(user_id, other, signal) {
      return this.api.banChatMember(orThrow(this.chatId, "banChatMember"), user_id, other, signal);
    }
    unbanChatMember(user_id, other, signal) {
      return this.api.unbanChatMember(orThrow(this.chatId, "unbanChatMember"), user_id, other, signal);
    }
    restrictAuthor(permissions, other, signal) {
      return this.api.restrictChatMember(orThrow(this.chatId, "restrictAuthor"), orThrow(this.from, "restrictAuthor").id, permissions, other, signal);
    }
    restrictChatMember(user_id, permissions, other, signal) {
      return this.api.restrictChatMember(orThrow(this.chatId, "restrictChatMember"), user_id, permissions, other, signal);
    }
    promoteAuthor(other, signal) {
      return this.api.promoteChatMember(orThrow(this.chatId, "promoteAuthor"), orThrow(this.from, "promoteAuthor").id, other, signal);
    }
    promoteChatMember(user_id, other, signal) {
      return this.api.promoteChatMember(orThrow(this.chatId, "promoteChatMember"), user_id, other, signal);
    }
    setChatAdministratorAuthorCustomTitle(custom_title, signal) {
      return this.api.setChatAdministratorCustomTitle(orThrow(this.chatId, "setChatAdministratorAuthorCustomTitle"), orThrow(this.from, "setChatAdministratorAuthorCustomTitle").id, custom_title, signal);
    }
    setChatAdministratorCustomTitle(user_id, custom_title, signal) {
      return this.api.setChatAdministratorCustomTitle(orThrow(this.chatId, "setChatAdministratorCustomTitle"), user_id, custom_title, signal);
    }
    setAuthorTag(tag, signal) {
      return this.api.setChatMemberTag(orThrow(this.chatId, "setChatMemberTag"), orThrow(this.from, "setChatMemberTag").id, tag, signal);
    }
    setChatMemberTag(user_id, tag, signal) {
      return this.api.setChatMemberTag(orThrow(this.chatId, "setChatMemberTag"), user_id, tag, signal);
    }
    banChatSenderChat(sender_chat_id, signal) {
      return this.api.banChatSenderChat(orThrow(this.chatId, "banChatSenderChat"), sender_chat_id, signal);
    }
    unbanChatSenderChat(sender_chat_id, signal) {
      return this.api.unbanChatSenderChat(orThrow(this.chatId, "unbanChatSenderChat"), sender_chat_id, signal);
    }
    setChatPermissions(permissions, other, signal) {
      return this.api.setChatPermissions(orThrow(this.chatId, "setChatPermissions"), permissions, other, signal);
    }
    exportChatInviteLink(signal) {
      return this.api.exportChatInviteLink(orThrow(this.chatId, "exportChatInviteLink"), signal);
    }
    createChatInviteLink(other, signal) {
      return this.api.createChatInviteLink(orThrow(this.chatId, "createChatInviteLink"), other, signal);
    }
    editChatInviteLink(invite_link, other, signal) {
      return this.api.editChatInviteLink(orThrow(this.chatId, "editChatInviteLink"), invite_link, other, signal);
    }
    createChatSubscriptionInviteLink(subscription_period, subscription_price, other, signal) {
      return this.api.createChatSubscriptionInviteLink(orThrow(this.chatId, "createChatSubscriptionInviteLink"), subscription_period, subscription_price, other, signal);
    }
    editChatSubscriptionInviteLink(invite_link, other, signal) {
      return this.api.editChatSubscriptionInviteLink(orThrow(this.chatId, "editChatSubscriptionInviteLink"), invite_link, other, signal);
    }
    revokeChatInviteLink(invite_link, signal) {
      return this.api.revokeChatInviteLink(orThrow(this.chatId, "editChatInviteLink"), invite_link, signal);
    }
    approveChatJoinRequest(user_id, signal) {
      return this.api.approveChatJoinRequest(orThrow(this.chatId, "approveChatJoinRequest"), user_id, signal);
    }
    declineChatJoinRequest(user_id, signal) {
      return this.api.declineChatJoinRequest(orThrow(this.chatId, "declineChatJoinRequest"), user_id, signal);
    }
    answerChatJoinRequestQuery(result, signal) {
      var _a;
      return this.api.answerChatJoinRequestQuery(orThrow((_a = this.chatJoinRequest) === null || _a === undefined ? undefined : _a.query_id, "answerChatJoinRequestQuery"), result, signal);
    }
    replyWithChatJoinRequestWebApp(web_app_url, signal) {
      var _a;
      return this.api.sendChatJoinRequestWebApp(orThrow((_a = this.chatJoinRequest) === null || _a === undefined ? undefined : _a.query_id, "answerChatJoinRequestQuery"), web_app_url, signal);
    }
    approveSuggestedPost(other, signal) {
      return this.api.approveSuggestedPost(orThrow(this.chatId, "approveSuggestedPost"), orThrow(this.msgId, "approveSuggestedPost"), other, signal);
    }
    declineSuggestedPost(other, signal) {
      return this.api.declineSuggestedPost(orThrow(this.chatId, "declineSuggestedPost"), orThrow(this.msgId, "declineSuggestedPost"), other, signal);
    }
    setChatPhoto(photo, signal) {
      return this.api.setChatPhoto(orThrow(this.chatId, "setChatPhoto"), photo, signal);
    }
    deleteChatPhoto(signal) {
      return this.api.deleteChatPhoto(orThrow(this.chatId, "deleteChatPhoto"), signal);
    }
    setChatTitle(title, signal) {
      return this.api.setChatTitle(orThrow(this.chatId, "setChatTitle"), title, signal);
    }
    setChatDescription(description, signal) {
      return this.api.setChatDescription(orThrow(this.chatId, "setChatDescription"), description, signal);
    }
    pinChatMessage(message_id, other, signal) {
      return this.api.pinChatMessage(orThrow(this.chatId, "pinChatMessage"), message_id, { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    unpinChatMessage(message_id, other, signal) {
      return this.api.unpinChatMessage(orThrow(this.chatId, "unpinChatMessage"), message_id, { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    unpinAllChatMessages(signal) {
      return this.api.unpinAllChatMessages(orThrow(this.chatId, "unpinAllChatMessages"), signal);
    }
    leaveChat(signal) {
      return this.api.leaveChat(orThrow(this.chatId, "leaveChat"), signal);
    }
    getChat(signal) {
      return this.api.getChat(orThrow(this.chatId, "getChat"), signal);
    }
    getChatAdministrators(other, signal) {
      return this.api.getChatAdministrators(orThrow(this.chatId, "getChatAdministrators"), other, signal);
    }
    getChatMembersCount(...args) {
      return this.getChatMemberCount(...args);
    }
    getChatMemberCount(signal) {
      return this.api.getChatMemberCount(orThrow(this.chatId, "getChatMemberCount"), signal);
    }
    getAuthor(signal) {
      return this.api.getChatMember(orThrow(this.chatId, "getAuthor"), orThrow(this.from, "getAuthor").id, signal);
    }
    getChatMember(user_id, signal) {
      return this.api.getChatMember(orThrow(this.chatId, "getChatMember"), user_id, signal);
    }
    getUserPersonalChatMessages(limit, signal) {
      return this.api.getUserPersonalChatMessages(orThrow(this.from, "getUserPersonalChatMessages").id, limit, signal);
    }
    setChatStickerSet(sticker_set_name, signal) {
      return this.api.setChatStickerSet(orThrow(this.chatId, "setChatStickerSet"), sticker_set_name, signal);
    }
    deleteChatStickerSet(signal) {
      return this.api.deleteChatStickerSet(orThrow(this.chatId, "deleteChatStickerSet"), signal);
    }
    createForumTopic(name, other, signal) {
      return this.api.createForumTopic(orThrow(this.chatId, "createForumTopic"), name, other, signal);
    }
    editForumTopic(other, signal) {
      const message = orThrow(this.msg, "editForumTopic");
      const thread = orThrow(message.message_thread_id, "editForumTopic");
      return this.api.editForumTopic(message.chat.id, thread, other, signal);
    }
    closeForumTopic(signal) {
      const message = orThrow(this.msg, "closeForumTopic");
      const thread = orThrow(message.message_thread_id, "closeForumTopic");
      return this.api.closeForumTopic(message.chat.id, thread, signal);
    }
    reopenForumTopic(signal) {
      const message = orThrow(this.msg, "reopenForumTopic");
      const thread = orThrow(message.message_thread_id, "reopenForumTopic");
      return this.api.reopenForumTopic(message.chat.id, thread, signal);
    }
    deleteForumTopic(signal) {
      const message = orThrow(this.msg, "deleteForumTopic");
      const thread = orThrow(message.message_thread_id, "deleteForumTopic");
      return this.api.deleteForumTopic(message.chat.id, thread, signal);
    }
    unpinAllForumTopicMessages(signal) {
      const message = orThrow(this.msg, "unpinAllForumTopicMessages");
      const thread = orThrow(message.message_thread_id, "unpinAllForumTopicMessages");
      return this.api.unpinAllForumTopicMessages(message.chat.id, thread, signal);
    }
    editGeneralForumTopic(name, signal) {
      return this.api.editGeneralForumTopic(orThrow(this.chatId, "editGeneralForumTopic"), name, signal);
    }
    closeGeneralForumTopic(signal) {
      return this.api.closeGeneralForumTopic(orThrow(this.chatId, "closeGeneralForumTopic"), signal);
    }
    reopenGeneralForumTopic(signal) {
      return this.api.reopenGeneralForumTopic(orThrow(this.chatId, "reopenGeneralForumTopic"), signal);
    }
    hideGeneralForumTopic(signal) {
      return this.api.hideGeneralForumTopic(orThrow(this.chatId, "hideGeneralForumTopic"), signal);
    }
    unhideGeneralForumTopic(signal) {
      return this.api.unhideGeneralForumTopic(orThrow(this.chatId, "unhideGeneralForumTopic"), signal);
    }
    unpinAllGeneralForumTopicMessages(signal) {
      return this.api.unpinAllGeneralForumTopicMessages(orThrow(this.chatId, "unpinAllGeneralForumTopicMessages"), signal);
    }
    answerCallbackQuery(other, signal) {
      return this.api.answerCallbackQuery(orThrow(this.callbackQuery, "answerCallbackQuery").id, typeof other === "string" ? { text: other } : other, signal);
    }
    answerGuestQuery(result, signal) {
      var _a;
      return this.api.answerGuestQuery(orThrow((_a = this.guestMessage) === null || _a === undefined ? undefined : _a.guest_query_id, "answerGuestQuery"), result, signal);
    }
    setChatMenuButton(other, signal) {
      return this.api.setChatMenuButton(other, signal);
    }
    getChatMenuButton(other, signal) {
      return this.api.getChatMenuButton(other, signal);
    }
    setMyDefaultAdministratorRights(other, signal) {
      return this.api.setMyDefaultAdministratorRights(other, signal);
    }
    getMyDefaultAdministratorRights(other, signal) {
      return this.api.getMyDefaultAdministratorRights(other, signal);
    }
    editMessageText(text, other, signal) {
      var _a, _b, _c, _d, _e;
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.editMessageTextInline(inlineId, text, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.editMessageText(orThrow(this.chatId, "editMessageText"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "editMessageText"), text, { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    editMessageCaption(other, signal) {
      var _a, _b, _c, _d, _e;
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.editMessageCaptionInline(inlineId, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.editMessageCaption(orThrow(this.chatId, "editMessageCaption"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "editMessageCaption"), { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    editMessageMedia(media, other, signal) {
      var _a, _b, _c, _d, _e;
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.editMessageMediaInline(inlineId, media, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.editMessageMedia(orThrow(this.chatId, "editMessageMedia"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "editMessageMedia"), media, { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    editMessageReplyMarkup(other, signal) {
      var _a, _b, _c, _d, _e;
      const inlineId = this.inlineMessageId;
      return inlineId !== undefined ? this.api.editMessageReplyMarkupInline(inlineId, { business_connection_id: this.businessConnectionId, ...other }, signal) : this.api.editMessageReplyMarkup(orThrow(this.chatId, "editMessageReplyMarkup"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "editMessageReplyMarkup"), { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    stopPoll(other, signal) {
      var _a, _b, _c, _d, _e;
      return this.api.stopPoll(orThrow(this.chatId, "stopPoll"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "stopPoll"), { business_connection_id: this.businessConnectionId, ...other }, signal);
    }
    editEphemeralMessageText(text_or_rich_message, other, signal) {
      const msg = orThrow(this.msg, "editEphemeralMessageText");
      return this.api.editEphemeralMessageText(msg.chat.id, orThrow(msg.receiver_user, "editEphemeralMessageText").id, orThrow(msg.ephemeral_message_id, "editEphemeralMessageText"), text_or_rich_message, other, signal);
    }
    editEphemeralMessageMedia(media, other, signal) {
      const msg = orThrow(this.msg, "editEphemeralMessageMedia");
      return this.api.editEphemeralMessageMedia(msg.chat.id, orThrow(msg.receiver_user, "editEphemeralMessageMedia").id, orThrow(msg.ephemeral_message_id, "editEphemeralMessageMedia"), media, other, signal);
    }
    editEphemeralMessageCaption(caption, other, signal) {
      const msg = orThrow(this.msg, "editEphemeralMessageCaption");
      return this.api.editEphemeralMessageCaption(msg.chat.id, orThrow(msg.receiver_user, "editEphemeralMessageCaption").id, orThrow(msg.ephemeral_message_id, "editEphemeralMessageCaption"), caption, other, signal);
    }
    editEphemeralMessageReplyMarkup(other, signal) {
      const msg = orThrow(this.msg, "editEphemeralMessageReplyMarkup");
      return this.api.editEphemeralMessageReplyMarkup(msg.chat.id, orThrow(msg.receiver_user, "editEphemeralMessageReplyMarkup").id, orThrow(msg.ephemeral_message_id, "editEphemeralMessageReplyMarkup"), other, signal);
    }
    deleteMessage(signal) {
      var _a, _b, _c, _d, _e;
      return this.api.deleteMessage(orThrow(this.chatId, "deleteMessage"), orThrow((_d = (_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.message_id) !== null && _b !== undefined ? _b : (_c = this.messageReaction) === null || _c === undefined ? undefined : _c.message_id) !== null && _d !== undefined ? _d : (_e = this.messageReactionCount) === null || _e === undefined ? undefined : _e.message_id, "deleteMessage"), signal);
    }
    deleteMessages(message_ids, signal) {
      return this.api.deleteMessages(orThrow(this.chatId, "deleteMessages"), message_ids, signal);
    }
    deleteEphemeralMessage(signal) {
      const msg = orThrow(this.msg, "deleteEphemeralMessage");
      return this.api.deleteEphemeralMessage(msg.chat.id, orThrow(msg.receiver_user, "deleteEphemeralMessage").id, orThrow(msg.ephemeral_message_id, "deleteEphemeralMessage"), signal);
    }
    deleteMessageReaction(other, signal) {
      const reaction = orThrow(this.messageReaction, "deleteMessageReaction");
      if (reaction.user !== undefined) {
        return this.deleteMessageReactionUser(reaction.user.id, other, signal);
      } else if (reaction.actor_chat !== undefined) {
        return this.deleteMessageReactionChat(reaction.actor_chat.id, other, signal);
      } else {
        throw new Error("Missing information from message_reaction update for API call to deleteMessageReaction");
      }
    }
    deleteMessageReactionUser(user_id, other, signal) {
      return this.api.deleteMessageReactionUser(orThrow(this.chatId, "deleteMessageReactionUser"), orThrow(this.msgId, "deleteMessageReactionUser"), user_id, other, signal);
    }
    deleteMessageReactionChat(actor_chat_id, other, signal) {
      return this.api.deleteMessageReactionChat(orThrow(this.chatId, "deleteMessageReactionChat"), orThrow(this.msgId, "deleteMessageReactionChat"), actor_chat_id, other, signal);
    }
    deleteAllMessageReactions(other, signal) {
      var _a, _b, _c, _d;
      const chatId = orThrow(this.chatId, "deleteAllMessageReactions");
      const actor = (_c = (_b = (_a = this.messageReaction) === null || _a === undefined ? undefined : _a.actor_chat) !== null && _b !== undefined ? _b : this.senderChat) !== null && _c !== undefined ? _c : (_d = this.pollAnswer) === null || _d === undefined ? undefined : _d.voter_chat;
      if (actor !== undefined) {
        return this.api.deleteAllMessageReactionsChat(chatId, actor.id, other, signal);
      }
      const userId = orThrow(this.from, "deleteAllMessageReactions").id;
      return this.api.deleteAllMessageReactionsUser(chatId, userId, other, signal);
    }
    deleteAllMessageReactionsUser(user_id, other, signal) {
      return this.api.deleteAllMessageReactionsUser(orThrow(this.chatId, "deleteAllMessageReactionsUser"), user_id, other, signal);
    }
    deleteAllMessageReactionsChat(actor_chat_id, other, signal) {
      return this.api.deleteAllMessageReactionsChat(orThrow(this.chatId, "deleteAllMessageReactionsChat"), actor_chat_id, other, signal);
    }
    deleteBusinessMessages(message_ids, signal) {
      return this.api.deleteBusinessMessages(orThrow(this.businessConnectionId, "deleteBusinessMessages"), message_ids, signal);
    }
    setBusinessAccountName(first_name, other, signal) {
      return this.api.setBusinessAccountName(orThrow(this.businessConnectionId, "setBusinessAccountName"), first_name, other, signal);
    }
    setBusinessAccountUsername(username, signal) {
      return this.api.setBusinessAccountUsername(orThrow(this.businessConnectionId, "setBusinessAccountUsername"), username, signal);
    }
    setBusinessAccountBio(bio, signal) {
      return this.api.setBusinessAccountBio(orThrow(this.businessConnectionId, "setBusinessAccountBio"), bio, signal);
    }
    setBusinessAccountProfilePhoto(photo, other, signal) {
      return this.api.setBusinessAccountProfilePhoto(orThrow(this.businessConnectionId, "setBusinessAccountProfilePhoto"), photo, other, signal);
    }
    removeBusinessAccountProfilePhoto(other, signal) {
      return this.api.removeBusinessAccountProfilePhoto(orThrow(this.businessConnectionId, "removeBusinessAccountProfilePhoto"), other, signal);
    }
    setBusinessAccountGiftSettings(show_gift_button, accepted_gift_types, signal) {
      return this.api.setBusinessAccountGiftSettings(orThrow(this.businessConnectionId, "setBusinessAccountGiftSettings"), show_gift_button, accepted_gift_types, signal);
    }
    getBusinessAccountStarBalance(signal) {
      return this.api.getBusinessAccountStarBalance(orThrow(this.businessConnectionId, "getBusinessAccountStarBalance"), signal);
    }
    transferBusinessAccountStars(star_count, signal) {
      return this.api.transferBusinessAccountStars(orThrow(this.businessConnectionId, "transferBusinessAccountStars"), star_count, signal);
    }
    getBusinessAccountGifts(other, signal) {
      return this.api.getBusinessAccountGifts(orThrow(this.businessConnectionId, "getBusinessAccountGifts"), other, signal);
    }
    convertGiftToStars(owned_gift_id, signal) {
      return this.api.convertGiftToStars(orThrow(this.businessConnectionId, "convertGiftToStars"), owned_gift_id, signal);
    }
    upgradeGift(owned_gift_id, other, signal) {
      return this.api.upgradeGift(orThrow(this.businessConnectionId, "upgradeGift"), owned_gift_id, other, signal);
    }
    transferGift(owned_gift_id, new_owner_chat_id, star_count, signal) {
      return this.api.transferGift(orThrow(this.businessConnectionId, "transferGift"), owned_gift_id, new_owner_chat_id, star_count, signal);
    }
    postStory(content, active_period, other, signal) {
      return this.api.postStory(orThrow(this.businessConnectionId, "postStory"), content, active_period, other, signal);
    }
    repostStory(active_period, other, signal) {
      var _a;
      const story = orThrow((_a = this.msg) === null || _a === undefined ? undefined : _a.story, "repostStory");
      return this.api.repostStory(orThrow(this.businessConnectionId, "repostStory"), story.chat.id, story.id, active_period, other, signal);
    }
    editStory(story_id, content, other, signal) {
      return this.api.editStory(orThrow(this.businessConnectionId, "editStory"), story_id, content, other, signal);
    }
    deleteStory(story_id, signal) {
      return this.api.deleteStory(orThrow(this.businessConnectionId, "deleteStory"), story_id, signal);
    }
    replyWithSticker(sticker, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendSticker(orThrow(this.chatId, "sendSticker"), sticker, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    getCustomEmojiStickers(signal) {
      var _a, _b;
      return this.api.getCustomEmojiStickers(((_b = (_a = this.msg) === null || _a === undefined ? undefined : _a.entities) !== null && _b !== undefined ? _b : []).filter((e) => e.type === "custom_emoji").map((e) => e.custom_emoji_id), signal);
    }
    replyWithGift(gift_id, other, signal) {
      return this.api.sendGift(orThrow(this.from, "sendGift").id, gift_id, other, signal);
    }
    giftPremiumSubscription(month_count, star_count, other, signal) {
      return this.api.giftPremiumSubscription(orThrow(this.from, "giftPremiumSubscription").id, month_count, star_count, other, signal);
    }
    replyWithGiftToChannel(gift_id, other, signal) {
      return this.api.sendGiftToChannel(orThrow(this.chat, "sendGift").id, gift_id, other, signal);
    }
    answerInlineQuery(results, other, signal) {
      return this.api.answerInlineQuery(orThrow(this.inlineQuery, "answerInlineQuery").id, results, other, signal);
    }
    savePreparedInlineMessage(result, other, signal) {
      return this.api.savePreparedInlineMessage(orThrow(this.from, "savePreparedInlineMessage").id, result, other, signal);
    }
    savePreparedKeyboardButton(button, signal) {
      return this.api.savePreparedKeyboardButton(orThrow(this.from, "savePreparedKeyboardButton").id, button, signal);
    }
    replyWithInvoice(title, description, payload, currency, prices, other, signal) {
      var _a;
      const msg = this.msg;
      return this.api.sendInvoice(orThrow(this.chatId, "sendInvoice"), title, description, payload, currency, prices, {
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        direct_messages_topic_id: (_a = msg === null || msg === undefined ? undefined : msg.direct_messages_topic) === null || _a === undefined ? undefined : _a.topic_id,
        ...other
      }, signal);
    }
    answerShippingQuery(ok, other, signal) {
      return this.api.answerShippingQuery(orThrow(this.shippingQuery, "answerShippingQuery").id, ok, other, signal);
    }
    answerPreCheckoutQuery(ok, other, signal) {
      return this.api.answerPreCheckoutQuery(orThrow(this.preCheckoutQuery, "answerPreCheckoutQuery").id, ok, typeof other === "string" ? { error_message: other } : other, signal);
    }
    refundStarPayment(signal) {
      var _a;
      return this.api.refundStarPayment(orThrow(this.from, "refundStarPayment").id, orThrow((_a = this.msg) === null || _a === undefined ? undefined : _a.successful_payment, "refundStarPayment").telegram_payment_charge_id, signal);
    }
    editUserStarSubscription(telegram_payment_charge_id, is_canceled, signal) {
      return this.api.editUserStarSubscription(orThrow(this.from, "editUserStarSubscription").id, telegram_payment_charge_id, is_canceled, signal);
    }
    verifyUser(other, signal) {
      return this.api.verifyUser(orThrow(this.from, "verifyUser").id, other, signal);
    }
    verifyChat(other, signal) {
      return this.api.verifyChat(orThrow(this.chatId, "verifyChat"), other, signal);
    }
    removeUserVerification(signal) {
      return this.api.removeUserVerification(orThrow(this.from, "removeUserVerification").id, signal);
    }
    removeChatVerification(signal) {
      return this.api.removeChatVerification(orThrow(this.chatId, "removeChatVerification"), signal);
    }
    readBusinessMessage(signal) {
      return this.api.readBusinessMessage(orThrow(this.businessConnectionId, "readBusinessMessage"), orThrow(this.chatId, "readBusinessMessage"), orThrow(this.msgId, "readBusinessMessage"), signal);
    }
    setPassportDataErrors(errors, signal) {
      return this.api.setPassportDataErrors(orThrow(this.from, "setPassportDataErrors").id, errors, signal);
    }
    replyWithGame(game_short_name, other, signal) {
      const msg = this.msg;
      return this.api.sendGame(orThrow(this.chatId, "sendGame"), game_short_name, {
        business_connection_id: this.businessConnectionId,
        ...(msg === null || msg === undefined ? undefined : msg.is_topic_message) ? { message_thread_id: msg.message_thread_id } : {},
        ...other
      }, signal);
    }
  }
  exports.Context = Context;
  Context.has = checker;
  function orThrow(value, method) {
    if (value === undefined) {
      throw new Error(`Missing information for API call to ${method}`);
    }
    return value;
  }
  function triggerFn(trigger) {
    return toArray(trigger).map((t) => typeof t === "string" ? (txt) => txt === t ? t : null : (txt) => txt.match(t));
  }
  function match(ctx, content, triggers) {
    for (const t of triggers) {
      const res = t(content);
      if (res) {
        ctx.match = res;
        return true;
      }
    }
    return false;
  }
  function toArray(e) {
    return Array.isArray(e) ? e : [e];
  }
});

// runtime/node_modules/grammy/out/composer.js
var require_composer = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Composer = exports.BotError = undefined;
  exports.run = run;
  var context_js_1 = require_context();

  class BotError extends Error {
    constructor(error, ctx) {
      super(generateBotErrorMessage(error));
      this.error = error;
      this.ctx = ctx;
      this.name = "BotError";
      if (error instanceof Error)
        this.stack = error.stack;
    }
  }
  exports.BotError = BotError;
  function generateBotErrorMessage(error) {
    let msg;
    if (error instanceof Error) {
      msg = `${error.name} in middleware: ${error.message}`;
    } else {
      const type = typeof error;
      msg = `Non-error value of type ${type} thrown in middleware`;
      switch (type) {
        case "bigint":
        case "boolean":
        case "number":
        case "symbol":
          msg += `: ${error}`;
          break;
        case "string":
          msg += `: ${String(error).substring(0, 50)}`;
          break;
        default:
          msg += "!";
          break;
      }
    }
    return msg;
  }
  function flatten(mw) {
    return typeof mw === "function" ? mw : (ctx, next) => mw.middleware()(ctx, next);
  }
  function concat(first, andThen) {
    return async (ctx, next) => {
      let nextCalled = false;
      await first(ctx, async () => {
        if (nextCalled)
          throw new Error("`next` already called before!");
        else
          nextCalled = true;
        await andThen(ctx, next);
      });
    };
  }
  function pass(_ctx, next) {
    return next();
  }
  var leaf = () => Promise.resolve();
  async function run(middleware, ctx) {
    await middleware(ctx, leaf);
  }

  class Composer {
    constructor(...middleware) {
      this.handler = middleware.length === 0 ? pass : middleware.map(flatten).reduce(concat);
    }
    middleware() {
      return this.handler;
    }
    use(...middleware) {
      const composer = new Composer(...middleware);
      this.handler = concat(this.handler, flatten(composer));
      return composer;
    }
    on(filter, ...middleware) {
      return this.filter(context_js_1.Context.has.filterQuery(filter), ...middleware);
    }
    hears(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.text(trigger), ...middleware);
    }
    command(command, ...middleware) {
      return this.filter(context_js_1.Context.has.command(command), ...middleware);
    }
    reaction(reaction, ...middleware) {
      return this.filter(context_js_1.Context.has.reaction(reaction), ...middleware);
    }
    chatType(chatType, ...middleware) {
      return this.filter(context_js_1.Context.has.chatType(chatType), ...middleware);
    }
    callbackQuery(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.callbackQuery(trigger), ...middleware);
    }
    gameQuery(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.gameQuery(trigger), ...middleware);
    }
    inlineQuery(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.inlineQuery(trigger), ...middleware);
    }
    chosenInlineResult(resultId, ...middleware) {
      return this.filter(context_js_1.Context.has.chosenInlineResult(resultId), ...middleware);
    }
    preCheckoutQuery(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.preCheckoutQuery(trigger), ...middleware);
    }
    shippingQuery(trigger, ...middleware) {
      return this.filter(context_js_1.Context.has.shippingQuery(trigger), ...middleware);
    }
    filter(predicate, ...middleware) {
      const composer = new Composer(...middleware);
      this.branch(predicate, composer, pass);
      return composer;
    }
    drop(predicate, ...middleware) {
      return this.filter(async (ctx) => !await predicate(ctx), ...middleware);
    }
    fork(...middleware) {
      const composer = new Composer(...middleware);
      const fork = flatten(composer);
      this.use((ctx, next) => Promise.all([next(), run(fork, ctx)]));
      return composer;
    }
    lazy(middlewareFactory) {
      return this.use(async (ctx, next) => {
        const middleware = await middlewareFactory(ctx);
        const arr = Array.isArray(middleware) ? middleware : [middleware];
        await flatten(new Composer(...arr))(ctx, next);
      });
    }
    route(router, routeHandlers, fallback = pass) {
      return this.lazy(async (ctx) => {
        var _a;
        const route = await router(ctx);
        return (_a = route === undefined || !routeHandlers[route] ? fallback : routeHandlers[route]) !== null && _a !== undefined ? _a : [];
      });
    }
    branch(predicate, trueMiddleware, falseMiddleware) {
      return this.lazy(async (ctx) => await predicate(ctx) ? trueMiddleware : falseMiddleware);
    }
    errorBoundary(errorHandler, ...middleware) {
      const composer = new Composer(...middleware);
      const bound = flatten(composer);
      this.use(async (ctx, next) => {
        let nextCalled = false;
        const cont = () => (nextCalled = true, Promise.resolve());
        try {
          await bound(ctx, cont);
        } catch (err) {
          nextCalled = false;
          await errorHandler(new BotError(err, ctx), cont);
        }
        if (nextCalled)
          await next();
      });
      return composer;
    }
  }
  exports.Composer = Composer;
});

// runtime/node_modules/ms/index.js
var require_ms = __commonJS((exports, module) => {
  var s = 1000;
  var m = s * 60;
  var h = m * 60;
  var d = h * 24;
  var w = d * 7;
  var y = d * 365.25;
  module.exports = function(val, options) {
    options = options || {};
    var type = typeof val;
    if (type === "string" && val.length > 0) {
      return parse(val);
    } else if (type === "number" && isFinite(val)) {
      return options.long ? fmtLong(val) : fmtShort(val);
    }
    throw new Error("val is not a non-empty string or a valid number. val=" + JSON.stringify(val));
  };
  function parse(str) {
    str = String(str);
    if (str.length > 100) {
      return;
    }
    var match = /^(-?(?:\d+)?\.?\d+) *(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$/i.exec(str);
    if (!match) {
      return;
    }
    var n = parseFloat(match[1]);
    var type = (match[2] || "ms").toLowerCase();
    switch (type) {
      case "years":
      case "year":
      case "yrs":
      case "yr":
      case "y":
        return n * y;
      case "weeks":
      case "week":
      case "w":
        return n * w;
      case "days":
      case "day":
      case "d":
        return n * d;
      case "hours":
      case "hour":
      case "hrs":
      case "hr":
      case "h":
        return n * h;
      case "minutes":
      case "minute":
      case "mins":
      case "min":
      case "m":
        return n * m;
      case "seconds":
      case "second":
      case "secs":
      case "sec":
      case "s":
        return n * s;
      case "milliseconds":
      case "millisecond":
      case "msecs":
      case "msec":
      case "ms":
        return n;
      default:
        return;
    }
  }
  function fmtShort(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return Math.round(ms / d) + "d";
    }
    if (msAbs >= h) {
      return Math.round(ms / h) + "h";
    }
    if (msAbs >= m) {
      return Math.round(ms / m) + "m";
    }
    if (msAbs >= s) {
      return Math.round(ms / s) + "s";
    }
    return ms + "ms";
  }
  function fmtLong(ms) {
    var msAbs = Math.abs(ms);
    if (msAbs >= d) {
      return plural(ms, msAbs, d, "day");
    }
    if (msAbs >= h) {
      return plural(ms, msAbs, h, "hour");
    }
    if (msAbs >= m) {
      return plural(ms, msAbs, m, "minute");
    }
    if (msAbs >= s) {
      return plural(ms, msAbs, s, "second");
    }
    return ms + " ms";
  }
  function plural(ms, msAbs, n, name) {
    var isPlural = msAbs >= n * 1.5;
    return Math.round(ms / n) + " " + name + (isPlural ? "s" : "");
  }
});

// runtime/node_modules/debug/src/common.js
var require_common = __commonJS((exports, module) => {
  function setup(env) {
    createDebug.debug = createDebug;
    createDebug.default = createDebug;
    createDebug.coerce = coerce;
    createDebug.disable = disable;
    createDebug.enable = enable;
    createDebug.enabled = enabled;
    createDebug.humanize = require_ms();
    createDebug.destroy = destroy;
    Object.keys(env).forEach((key) => {
      createDebug[key] = env[key];
    });
    createDebug.names = [];
    createDebug.skips = [];
    createDebug.formatters = {};
    function selectColor(namespace) {
      let hash = 0;
      for (let i = 0;i < namespace.length; i++) {
        hash = (hash << 5) - hash + namespace.charCodeAt(i);
        hash |= 0;
      }
      return createDebug.colors[Math.abs(hash) % createDebug.colors.length];
    }
    createDebug.selectColor = selectColor;
    function createDebug(namespace) {
      let prevTime;
      let enableOverride = null;
      let namespacesCache;
      let enabledCache;
      function debug(...args) {
        if (!debug.enabled) {
          return;
        }
        const self = debug;
        const curr = Number(new Date);
        const ms = curr - (prevTime || curr);
        self.diff = ms;
        self.prev = prevTime;
        self.curr = curr;
        prevTime = curr;
        args[0] = createDebug.coerce(args[0]);
        if (typeof args[0] !== "string") {
          args.unshift("%O");
        }
        let index = 0;
        args[0] = args[0].replace(/%([a-zA-Z%])/g, (match, format) => {
          if (match === "%%") {
            return "%";
          }
          index++;
          const formatter = createDebug.formatters[format];
          if (typeof formatter === "function") {
            const val = args[index];
            match = formatter.call(self, val);
            args.splice(index, 1);
            index--;
          }
          return match;
        });
        createDebug.formatArgs.call(self, args);
        const logFn = self.log || createDebug.log;
        logFn.apply(self, args);
      }
      debug.namespace = namespace;
      debug.useColors = createDebug.useColors();
      debug.color = createDebug.selectColor(namespace);
      debug.extend = extend;
      debug.destroy = createDebug.destroy;
      Object.defineProperty(debug, "enabled", {
        enumerable: true,
        configurable: false,
        get: () => {
          if (enableOverride !== null) {
            return enableOverride;
          }
          if (namespacesCache !== createDebug.namespaces) {
            namespacesCache = createDebug.namespaces;
            enabledCache = createDebug.enabled(namespace);
          }
          return enabledCache;
        },
        set: (v) => {
          enableOverride = v;
        }
      });
      if (typeof createDebug.init === "function") {
        createDebug.init(debug);
      }
      return debug;
    }
    function extend(namespace, delimiter) {
      const newDebug = createDebug(this.namespace + (typeof delimiter === "undefined" ? ":" : delimiter) + namespace);
      newDebug.log = this.log;
      return newDebug;
    }
    function enable(namespaces) {
      createDebug.save(namespaces);
      createDebug.namespaces = namespaces;
      createDebug.names = [];
      createDebug.skips = [];
      const split = (typeof namespaces === "string" ? namespaces : "").trim().replace(/\s+/g, ",").split(",").filter(Boolean);
      for (const ns of split) {
        if (ns[0] === "-") {
          createDebug.skips.push(ns.slice(1));
        } else {
          createDebug.names.push(ns);
        }
      }
    }
    function matchesTemplate(search, template) {
      let searchIndex = 0;
      let templateIndex = 0;
      let starIndex = -1;
      let matchIndex = 0;
      while (searchIndex < search.length) {
        if (templateIndex < template.length && (template[templateIndex] === search[searchIndex] || template[templateIndex] === "*")) {
          if (template[templateIndex] === "*") {
            starIndex = templateIndex;
            matchIndex = searchIndex;
            templateIndex++;
          } else {
            searchIndex++;
            templateIndex++;
          }
        } else if (starIndex !== -1) {
          templateIndex = starIndex + 1;
          matchIndex++;
          searchIndex = matchIndex;
        } else {
          return false;
        }
      }
      while (templateIndex < template.length && template[templateIndex] === "*") {
        templateIndex++;
      }
      return templateIndex === template.length;
    }
    function disable() {
      const namespaces = [
        ...createDebug.names,
        ...createDebug.skips.map((namespace) => "-" + namespace)
      ].join(",");
      createDebug.enable("");
      return namespaces;
    }
    function enabled(name) {
      for (const skip of createDebug.skips) {
        if (matchesTemplate(name, skip)) {
          return false;
        }
      }
      for (const ns of createDebug.names) {
        if (matchesTemplate(name, ns)) {
          return true;
        }
      }
      return false;
    }
    function coerce(val) {
      if (val instanceof Error) {
        return val.stack || val.message;
      }
      return val;
    }
    function destroy() {
      console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
    }
    createDebug.enable(createDebug.load());
    return createDebug;
  }
  module.exports = setup;
});

// runtime/node_modules/debug/src/browser.js
var require_browser = __commonJS((exports, module) => {
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.storage = localstorage();
  exports.destroy = (() => {
    let warned = false;
    return () => {
      if (!warned) {
        warned = true;
        console.warn("Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
      }
    };
  })();
  exports.colors = [
    "#0000CC",
    "#0000FF",
    "#0033CC",
    "#0033FF",
    "#0066CC",
    "#0066FF",
    "#0099CC",
    "#0099FF",
    "#00CC00",
    "#00CC33",
    "#00CC66",
    "#00CC99",
    "#00CCCC",
    "#00CCFF",
    "#3300CC",
    "#3300FF",
    "#3333CC",
    "#3333FF",
    "#3366CC",
    "#3366FF",
    "#3399CC",
    "#3399FF",
    "#33CC00",
    "#33CC33",
    "#33CC66",
    "#33CC99",
    "#33CCCC",
    "#33CCFF",
    "#6600CC",
    "#6600FF",
    "#6633CC",
    "#6633FF",
    "#66CC00",
    "#66CC33",
    "#9900CC",
    "#9900FF",
    "#9933CC",
    "#9933FF",
    "#99CC00",
    "#99CC33",
    "#CC0000",
    "#CC0033",
    "#CC0066",
    "#CC0099",
    "#CC00CC",
    "#CC00FF",
    "#CC3300",
    "#CC3333",
    "#CC3366",
    "#CC3399",
    "#CC33CC",
    "#CC33FF",
    "#CC6600",
    "#CC6633",
    "#CC9900",
    "#CC9933",
    "#CCCC00",
    "#CCCC33",
    "#FF0000",
    "#FF0033",
    "#FF0066",
    "#FF0099",
    "#FF00CC",
    "#FF00FF",
    "#FF3300",
    "#FF3333",
    "#FF3366",
    "#FF3399",
    "#FF33CC",
    "#FF33FF",
    "#FF6600",
    "#FF6633",
    "#FF9900",
    "#FF9933",
    "#FFCC00",
    "#FFCC33"
  ];
  function useColors() {
    if (typeof window !== "undefined" && window.process && (window.process.type === "renderer" || window.process.__nwjs)) {
      return true;
    }
    if (typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/(edge|trident)\/(\d+)/)) {
      return false;
    }
    let m;
    return typeof document !== "undefined" && document.documentElement && document.documentElement.style && document.documentElement.style.WebkitAppearance || typeof window !== "undefined" && window.console && (window.console.firebug || window.console.exception && window.console.table) || typeof navigator !== "undefined" && navigator.userAgent && (m = navigator.userAgent.toLowerCase().match(/firefox\/(\d+)/)) && parseInt(m[1], 10) >= 31 || typeof navigator !== "undefined" && navigator.userAgent && navigator.userAgent.toLowerCase().match(/applewebkit\/(\d+)/);
  }
  function formatArgs(args) {
    args[0] = (this.useColors ? "%c" : "") + this.namespace + (this.useColors ? " %c" : " ") + args[0] + (this.useColors ? "%c " : " ") + "+" + module.exports.humanize(this.diff);
    if (!this.useColors) {
      return;
    }
    const c = "color: " + this.color;
    args.splice(1, 0, c, "color: inherit");
    let index = 0;
    let lastC = 0;
    args[0].replace(/%[a-zA-Z%]/g, (match) => {
      if (match === "%%") {
        return;
      }
      index++;
      if (match === "%c") {
        lastC = index;
      }
    });
    args.splice(lastC, 0, c);
  }
  exports.log = console.debug || console.log || (() => {});
  function save(namespaces) {
    try {
      if (namespaces) {
        exports.storage.setItem("debug", namespaces);
      } else {
        exports.storage.removeItem("debug");
      }
    } catch (error) {}
  }
  function load() {
    let r;
    try {
      r = exports.storage.getItem("debug") || exports.storage.getItem("DEBUG");
    } catch (error) {}
    if (!r && typeof process !== "undefined" && "env" in process) {
      r = process.env.DEBUG;
    }
    return r;
  }
  function localstorage() {
    try {
      return localStorage;
    } catch (error) {}
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.j = function(v) {
    try {
      return JSON.stringify(v);
    } catch (error) {
      return "[UnexpectedJSONParseError]: " + error.message;
    }
  };
});

// runtime/node_modules/debug/src/node.js
var require_node = __commonJS((exports, module) => {
  var tty = __require("tty");
  var util = __require("util");
  exports.init = init;
  exports.log = log;
  exports.formatArgs = formatArgs;
  exports.save = save;
  exports.load = load;
  exports.useColors = useColors;
  exports.destroy = util.deprecate(() => {}, "Instance method `debug.destroy()` is deprecated and no longer does anything. It will be removed in the next major version of `debug`.");
  exports.colors = [6, 2, 3, 4, 5, 1];
  try {
    const supportsColor = (()=>{throw new Error("Cannot require module "+"supports-color");})();
    if (supportsColor && (supportsColor.stderr || supportsColor).level >= 2) {
      exports.colors = [
        20,
        21,
        26,
        27,
        32,
        33,
        38,
        39,
        40,
        41,
        42,
        43,
        44,
        45,
        56,
        57,
        62,
        63,
        68,
        69,
        74,
        75,
        76,
        77,
        78,
        79,
        80,
        81,
        92,
        93,
        98,
        99,
        112,
        113,
        128,
        129,
        134,
        135,
        148,
        149,
        160,
        161,
        162,
        163,
        164,
        165,
        166,
        167,
        168,
        169,
        170,
        171,
        172,
        173,
        178,
        179,
        184,
        185,
        196,
        197,
        198,
        199,
        200,
        201,
        202,
        203,
        204,
        205,
        206,
        207,
        208,
        209,
        214,
        215,
        220,
        221
      ];
    }
  } catch (error) {}
  exports.inspectOpts = Object.keys(process.env).filter((key) => {
    return /^debug_/i.test(key);
  }).reduce((obj, key) => {
    const prop = key.substring(6).toLowerCase().replace(/_([a-z])/g, (_, k) => {
      return k.toUpperCase();
    });
    let val = process.env[key];
    if (/^(yes|on|true|enabled)$/i.test(val)) {
      val = true;
    } else if (/^(no|off|false|disabled)$/i.test(val)) {
      val = false;
    } else if (val === "null") {
      val = null;
    } else {
      val = Number(val);
    }
    obj[prop] = val;
    return obj;
  }, {});
  function useColors() {
    return "colors" in exports.inspectOpts ? Boolean(exports.inspectOpts.colors) : tty.isatty(process.stderr.fd);
  }
  function formatArgs(args) {
    const { namespace: name, useColors: useColors2 } = this;
    if (useColors2) {
      const c = this.color;
      const colorCode = "\x1B[3" + (c < 8 ? c : "8;5;" + c);
      const prefix = `  ${colorCode};1m${name} \x1B[0m`;
      args[0] = prefix + args[0].split(`
`).join(`
` + prefix);
      args.push(colorCode + "m+" + module.exports.humanize(this.diff) + "\x1B[0m");
    } else {
      args[0] = getDate() + name + " " + args[0];
    }
  }
  function getDate() {
    if (exports.inspectOpts.hideDate) {
      return "";
    }
    return new Date().toISOString() + " ";
  }
  function log(...args) {
    return process.stderr.write(util.formatWithOptions(exports.inspectOpts, ...args) + `
`);
  }
  function save(namespaces) {
    if (namespaces) {
      process.env.DEBUG = namespaces;
    } else {
      delete process.env.DEBUG;
    }
  }
  function load() {
    return process.env.DEBUG;
  }
  function init(debug) {
    debug.inspectOpts = {};
    const keys = Object.keys(exports.inspectOpts);
    for (let i = 0;i < keys.length; i++) {
      debug.inspectOpts[keys[i]] = exports.inspectOpts[keys[i]];
    }
  }
  module.exports = require_common()(exports);
  var { formatters } = module.exports;
  formatters.o = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts).split(`
`).map((str) => str.trim()).join(" ");
  };
  formatters.O = function(v) {
    this.inspectOpts.colors = this.useColors;
    return util.inspect(v, this.inspectOpts);
  };
});

// runtime/node_modules/debug/src/index.js
var require_src = __commonJS((exports, module) => {
  if (typeof process === "undefined" || process.type === "renderer" || false || process.__nwjs) {
    module.exports = require_browser();
  } else {
    module.exports = require_node();
  }
});

// runtime/node_modules/grammy/out/platform.node.js
var require_platform_node = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.defaultAdapter = exports.itrToStream = exports.debug = undefined;
  exports.baseFetchConfig = baseFetchConfig;
  var http_1 = __require("http");
  var https_1 = __require("https");
  var stream_1 = __require("stream");
  var debug_1 = require_src();
  Object.defineProperty(exports, "debug", { enumerable: true, get: function() {
    return debug_1.debug;
  } });
  var itrToStream = (itr) => stream_1.Readable.from(itr, { objectMode: false });
  exports.itrToStream = itrToStream;
  var httpAgents = new Map;
  var httpsAgents = new Map;
  function getCached(map, key, otherwise) {
    let value = map.get(key);
    if (value === undefined) {
      value = otherwise();
      map.set(key, value);
    }
    return value;
  }
  function baseFetchConfig(apiRoot) {
    if (apiRoot.startsWith("https:")) {
      return {
        compress: true,
        agent: getCached(httpsAgents, apiRoot, () => new https_1.Agent({ keepAlive: true })),
        duplex: "half"
      };
    } else if (apiRoot.startsWith("http:")) {
      return {
        agent: getCached(httpAgents, apiRoot, () => new http_1.Agent({ keepAlive: true })),
        duplex: "half"
      };
    } else
      return { duplex: "half" };
  }
  exports.defaultAdapter = "express";
});

// runtime/node_modules/grammy/out/core/error.js
var require_error = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.HttpError = exports.GrammyError = undefined;
  exports.toGrammyError = toGrammyError;
  exports.toHttpError = toHttpError;
  var platform_node_js_1 = require_platform_node();
  var debug = (0, platform_node_js_1.debug)("grammy:warn");

  class GrammyError extends Error {
    constructor(message, err, method, payload) {
      var _a;
      super(`${message} (${err.error_code}: ${err.description})`);
      this.method = method;
      this.payload = payload;
      this.ok = false;
      this.name = "GrammyError";
      this.error_code = err.error_code;
      this.description = err.description;
      this.parameters = (_a = err.parameters) !== null && _a !== undefined ? _a : {};
    }
  }
  exports.GrammyError = GrammyError;
  function toGrammyError(err, method, payload) {
    switch (err.error_code) {
      case 401:
        debug("Error 401 means that your bot token is wrong, talk to https://t.me/BotFather to check it.");
        break;
      case 409:
        debug("Error 409 means that you are running your bot several times on long polling. Consider revoking the bot token if you believe that no other instance is running.");
        break;
    }
    return new GrammyError(`Call to '${method}' failed!`, err, method, payload);
  }

  class HttpError extends Error {
    constructor(message, error) {
      super(message);
      this.error = error;
      this.name = "HttpError";
    }
  }
  exports.HttpError = HttpError;
  function isTelegramError(err) {
    return typeof err === "object" && err !== null && "status" in err && "statusText" in err;
  }
  function toHttpError(method, sensitiveLogs, err) {
    let msg = `Network request for '${method}' failed!`;
    if (isTelegramError(err))
      msg += ` (${err.status}: ${err.statusText})`;
    if (sensitiveLogs && err instanceof Error)
      msg += ` ${err.message}`;
    return new HttpError(msg, err);
  }
});

// runtime/node_modules/@grammyjs/types/mod.js
var exports_mod = {};

// runtime/node_modules/grammy/out/types.node.js
var require_types_node = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.InputFile = undefined;
  var fs_1 = __require("fs");
  var node_fetch_1 = __require("node-fetch");
  var path_1 = __require("path");
  var platform_node_1 = require_platform_node();
  var debug = (0, platform_node_1.debug)("grammy:warn");
  __exportStar(__toCommonJS(exports_mod), exports);

  class InputFile {
    constructor(file, filename) {
      this.consumed = false;
      this.fileData = file;
      filename !== null && filename !== undefined || (filename = this.guessFilename(file));
      this.filename = filename;
      if (typeof file === "string" && (file.startsWith("http:") || file.startsWith("https:"))) {
        debug(`InputFile received the local file path '${file}' that looks like a URL. Is this a mistake?`);
      }
    }
    guessFilename(file) {
      if (typeof file === "string")
        return (0, path_1.basename)(file);
      if ("url" in file)
        return (0, path_1.basename)(file.url);
      if (!(file instanceof URL))
        return;
      if (file.pathname !== "/") {
        const filename = (0, path_1.basename)(file.pathname);
        if (filename)
          return filename;
      }
      return (0, path_1.basename)(file.hostname);
    }
    async toRaw() {
      if (this.consumed) {
        throw new Error("Cannot reuse InputFile data source!");
      }
      const data = this.fileData;
      if (typeof data === "string")
        return (0, fs_1.createReadStream)(data);
      if (data instanceof URL) {
        return data.protocol === "file" ? (0, fs_1.createReadStream)(data.pathname) : fetchFile(data);
      }
      if ("url" in data)
        return fetchFile(data.url);
      if (data instanceof Uint8Array)
        return data;
      if (typeof data === "function") {
        return new InputFile(await data()).toRaw();
      }
      this.consumed = true;
      return data;
    }
    toJSON() {
      throw new Error("InputFile instances must be sent via grammY");
    }
  }
  exports.InputFile = InputFile;
  async function* fetchFile(url) {
    const { body } = await (0, node_fetch_1.default)(url);
    for await (const chunk of body) {
      if (typeof chunk === "string") {
        throw new Error(`Could not transfer file, received string data instead of bytes from '${url}'`);
      }
      yield chunk;
    }
  }
});

// runtime/node_modules/grammy/out/types.js
var require_types = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  __exportStar(require_types_node(), exports);
});

// runtime/node_modules/grammy/out/core/payload.js
var require_payload = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.requiresFormDataUpload = requiresFormDataUpload;
  exports.createJsonPayload = createJsonPayload;
  exports.createFormDataPayload = createFormDataPayload;
  var platform_node_js_1 = require_platform_node();
  var types_js_1 = require_types();
  function requiresFormDataUpload(payload) {
    return payload instanceof types_js_1.InputFile || typeof payload === "object" && payload !== null && Object.values(payload).some((v) => Array.isArray(v) ? v.some(requiresFormDataUpload) : v instanceof types_js_1.InputFile || requiresFormDataUpload(v));
  }
  function str(value) {
    return JSON.stringify(value, (_, v) => v !== null && v !== undefined ? v : undefined);
  }
  function createJsonPayload(payload) {
    return {
      method: "POST",
      headers: {
        "content-type": "application/json",
        connection: "keep-alive"
      },
      body: str(payload)
    };
  }
  async function* protectItr(itr, onError) {
    try {
      yield* itr;
    } catch (err) {
      onError(err);
    }
  }
  function createFormDataPayload(payload, onError) {
    const boundary = createBoundary();
    const itr = payloadToMultipartItr(payload, boundary);
    const safeItr = protectItr(itr, onError);
    const stream = (0, platform_node_js_1.itrToStream)(safeItr);
    return {
      method: "POST",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        connection: "keep-alive"
      },
      body: stream
    };
  }
  function createBoundary() {
    return "----------" + randomId(32);
  }
  function randomId(length = 16) {
    return Array.from(Array(length)).map(() => Math.random().toString(36)[2] || 0).join("");
  }
  var enc = new TextEncoder;
  async function* payloadToMultipartItr(payload, boundary) {
    const files = collectFiles(payload);
    yield enc.encode(`--${boundary}\r
`);
    const separator = enc.encode(`\r
--${boundary}\r
`);
    let first = true;
    for (const [key, value] of Object.entries(payload)) {
      if (value == null)
        continue;
      if (!first)
        yield separator;
      yield valuePart(key, value instanceof types_js_1.InputFile ? value.toJSON() : typeof value === "object" ? str(value) : value);
      first = false;
    }
    for (const { id, origin, file } of files) {
      if (!first)
        yield separator;
      yield* filePart(id, origin, file);
      first = false;
    }
    yield enc.encode(`\r
--${boundary}--\r
`);
  }
  function collectFiles(value) {
    if (typeof value !== "object" || value === null)
      return [];
    return Object.entries(value).flatMap(([k, v]) => {
      if (Array.isArray(v))
        return v.flatMap((p) => collectFiles(p));
      else if (v instanceof types_js_1.InputFile) {
        const id = randomId();
        Object.assign(v, { toJSON: () => `attach://${id}` });
        const origin = k === "media" && "type" in value && typeof value.type === "string" ? value.type : k;
        return { id, origin, file: v };
      } else
        return collectFiles(v);
    });
  }
  function valuePart(key, value) {
    return enc.encode(`content-disposition:form-data;name="${key}"\r
\r
${value}`);
  }
  async function* filePart(id, origin, input) {
    const filename = input.filename || `${origin}.${getExt(origin)}`;
    if (filename.includes("\r") || filename.includes(`
`)) {
      throw new Error(`File paths cannot contain carriage-return (\\r) or newline (\\n) characters! Filename for property '${origin}' was:
"""
${filename}
"""`);
    }
    yield enc.encode(`content-disposition:form-data;name="${id}";filename=${filename}\r
content-type:application/octet-stream\r
\r
`);
    const data = await input.toRaw();
    if (data instanceof Uint8Array)
      yield data;
    else
      yield* data;
  }
  function getExt(key) {
    switch (key) {
      case "certificate":
        return "pem";
      case "photo":
      case "thumbnail":
        return "jpg";
      case "voice":
        return "ogg";
      case "audio":
        return "mp3";
      case "animation":
      case "video":
      case "video_note":
        return "mp4";
      case "sticker":
        return "webp";
      default:
        return "dat";
    }
  }
});

// runtime/node_modules/grammy/out/shim.node.js
var require_shim_node = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.fetch = exports.AbortController = undefined;
  var abort_controller_1 = __require("abort-controller");
  Object.defineProperty(exports, "AbortController", { enumerable: true, get: function() {
    return abort_controller_1.AbortController;
  } });
  var node_fetch_1 = __require("node-fetch");
  Object.defineProperty(exports, "fetch", { enumerable: true, get: function() {
    return node_fetch_1.default;
  } });
});

// runtime/node_modules/grammy/out/core/client.js
var require_client = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.createRawApi = createRawApi;
  var platform_node_js_1 = require_platform_node();
  var error_js_1 = require_error();
  var payload_js_1 = require_payload();
  var debug = (0, platform_node_js_1.debug)("grammy:core");
  function concatTransformer(prev, trans) {
    return (method, payload, signal) => trans(prev, method, payload, signal);
  }

  class ApiClient {
    constructor(token, options = {}, webhookReplyEnvelope = {}) {
      var _a, _b, _c, _d, _e, _f;
      this.token = token;
      this.webhookReplyEnvelope = webhookReplyEnvelope;
      this.hasUsedWebhookReply = false;
      this.installedTransformers = [];
      this.call = async (method, p, signal) => {
        const payload = p !== null && p !== undefined ? p : {};
        debug(`Calling ${method}`);
        if (signal !== undefined)
          validateSignal(method, payload, signal);
        const opts = this.options;
        const formDataRequired = (0, payload_js_1.requiresFormDataUpload)(payload);
        if (this.webhookReplyEnvelope.send !== undefined && !this.hasUsedWebhookReply && !formDataRequired && opts.canUseWebhookReply(method)) {
          this.hasUsedWebhookReply = true;
          const config2 = (0, payload_js_1.createJsonPayload)({ ...payload, method });
          await this.webhookReplyEnvelope.send(config2.body);
          return { ok: true, result: true };
        }
        const { controller, unregisterSignal } = createAbortControllerFromSignal(signal);
        const timeout = createTimeout(controller, opts.timeoutSeconds, method);
        const streamErr = createStreamError(controller);
        const url = opts.buildUrl(opts.apiRoot, this.token, method, opts.environment);
        const config = formDataRequired ? (0, payload_js_1.createFormDataPayload)(payload, (err) => streamErr.catch(err)) : (0, payload_js_1.createJsonPayload)(payload);
        const sig = controller.signal;
        const options2 = { ...opts.baseFetchConfig, signal: sig, ...config };
        const successPromise = this.fetch(url, options2).then((res) => res.json());
        const operations = [successPromise, streamErr.promise, timeout.promise];
        try {
          return await Promise.race(operations);
        } catch (error) {
          throw (0, error_js_1.toHttpError)(method, opts.sensitiveLogs, error);
        } finally {
          if (timeout.handle !== undefined)
            clearTimeout(timeout.handle);
          unregisterSignal === null || unregisterSignal === undefined || unregisterSignal();
        }
      };
      const apiRoot = (_a = options.apiRoot) !== null && _a !== undefined ? _a : "https://api.telegram.org";
      const environment = (_b = options.environment) !== null && _b !== undefined ? _b : "prod";
      const { fetch: customFetch } = options;
      const fetchFn = customFetch !== null && customFetch !== undefined ? customFetch : shim_node_js_1.fetch;
      this.options = {
        apiRoot,
        environment,
        buildUrl: (_c = options.buildUrl) !== null && _c !== undefined ? _c : defaultBuildUrl,
        timeoutSeconds: (_d = options.timeoutSeconds) !== null && _d !== undefined ? _d : 500,
        baseFetchConfig: {
          ...(0, platform_node_js_1.baseFetchConfig)(apiRoot),
          ...options.baseFetchConfig
        },
        canUseWebhookReply: (_e = options.canUseWebhookReply) !== null && _e !== undefined ? _e : () => false,
        sensitiveLogs: (_f = options.sensitiveLogs) !== null && _f !== undefined ? _f : false,
        fetch: (...args) => fetchFn(...args)
      };
      this.fetch = this.options.fetch;
      if (this.options.apiRoot.endsWith("/")) {
        throw new Error(`Remove the trailing '/' from the 'apiRoot' option (use '${this.options.apiRoot.substring(0, this.options.apiRoot.length - 1)}' instead of '${this.options.apiRoot}')`);
      }
    }
    use(...transformers) {
      this.call = transformers.reduce(concatTransformer, this.call);
      this.installedTransformers.push(...transformers);
      return this;
    }
    async callApi(method, payload, signal) {
      const data = await this.call(method, payload, signal);
      if (data.ok)
        return data.result;
      else
        throw (0, error_js_1.toGrammyError)(data, method, payload);
    }
  }
  function createRawApi(token, options, webhookReplyEnvelope) {
    const client = new ApiClient(token, options, webhookReplyEnvelope);
    const proxyHandler = {
      get(_, m) {
        return m === "toJSON" ? "__internal" : m === "getMe" || m === "getWebhookInfo" || m === "getForumTopicIconStickers" || m === "getAvailableGifts" || m === "logOut" || m === "close" || m === "getMyStarBalance" || m === "removeMyProfilePhoto" ? client.callApi.bind(client, m, {}) : client.callApi.bind(client, m);
      },
      ...proxyMethods
    };
    const raw = new Proxy({}, proxyHandler);
    const installedTransformers = client.installedTransformers;
    const api = {
      raw,
      installedTransformers,
      use: (...t) => {
        client.use(...t);
        return api;
      }
    };
    return api;
  }
  var defaultBuildUrl = (root, token, method, env) => {
    const prefix = env === "test" ? "test/" : "";
    return `${root}/bot${token}/${prefix}${method}`;
  };
  var proxyMethods = {
    set() {
      return false;
    },
    defineProperty() {
      return false;
    },
    deleteProperty() {
      return false;
    },
    ownKeys() {
      return [];
    }
  };
  function createTimeout(controller, seconds, method) {
    let handle = undefined;
    const promise = new Promise((_, reject) => {
      handle = setTimeout(() => {
        const msg = `Request to '${method}' timed out after ${seconds} seconds`;
        reject(new Error(msg));
        controller.abort();
      }, 1000 * seconds);
    });
    return { promise, handle };
  }
  function createStreamError(abortController) {
    let onError = (err) => {
      throw err;
    };
    const promise = new Promise((_, reject) => {
      onError = (err) => {
        reject(err);
        abortController.abort();
      };
    });
    return { promise, catch: onError };
  }
  function createAbortControllerFromSignal(signal) {
    const controller = new shim_node_js_1.AbortController;
    if (signal === undefined) {
      return { controller, unregisterSignal: undefined };
    }
    const sig = signal;
    function abort() {
      controller.abort();
      unregisterSignal();
    }
    function unregisterSignal() {
      sig.removeEventListener("abort", abort);
    }
    if (sig.aborted)
      abort();
    else
      sig.addEventListener("abort", abort);
    return {
      controller: { abort, signal: controller.signal },
      unregisterSignal
    };
  }
  function validateSignal(method, payload, signal) {
    if (typeof (signal === null || signal === undefined ? undefined : signal.addEventListener) === "function") {
      return;
    }
    let payload0 = JSON.stringify(payload);
    if (payload0.length > 20) {
      payload0 = payload0.substring(0, 16) + " ...";
    }
    let payload1 = JSON.stringify(signal);
    if (payload1.length > 20) {
      payload1 = payload1.substring(0, 16) + " ...";
    }
    throw new Error(`Incorrect abort signal instance found! You passed two payloads to '${method}' but you should merge the second one containing '${payload1}' into the first one containing '${payload0}'! If you are using context shortcuts, you may want to use a method on 'ctx.api' instead.

If you want to prevent such mistakes in the future, consider using TypeScript. https://www.typescriptlang.org/`);
  }
  var shim_node_js_1 = require_shim_node();
});

// runtime/node_modules/grammy/out/core/api.js
var require_api = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Api = undefined;
  var client_js_1 = require_client();

  class Api {
    constructor(token, options, webhookReplyEnvelope) {
      this.token = token;
      this.options = options;
      const { raw, use, installedTransformers } = (0, client_js_1.createRawApi)(token, options, webhookReplyEnvelope);
      this.raw = raw;
      this.config = {
        use,
        installedTransformers: () => installedTransformers.slice()
      };
    }
    getUpdates(other, signal) {
      return this.raw.getUpdates({ ...other }, signal);
    }
    setWebhook(url, other, signal) {
      return this.raw.setWebhook({ url, ...other }, signal);
    }
    deleteWebhook(other, signal) {
      return this.raw.deleteWebhook({ ...other }, signal);
    }
    getWebhookInfo(signal) {
      return this.raw.getWebhookInfo(signal);
    }
    getMe(signal) {
      return this.raw.getMe(signal);
    }
    logOut(signal) {
      return this.raw.logOut(signal);
    }
    close(signal) {
      return this.raw.close(signal);
    }
    sendMessage(chat_id, text, other, signal) {
      return this.raw.sendMessage({ chat_id, text, ...other }, signal);
    }
    sendRichMessage(chat_id, rich_message, other, signal) {
      return this.raw.sendRichMessage({ chat_id, rich_message, ...other }, signal);
    }
    forwardMessage(chat_id, from_chat_id, message_id, other, signal) {
      return this.raw.forwardMessage({ chat_id, from_chat_id, message_id, ...other }, signal);
    }
    forwardMessages(chat_id, from_chat_id, message_ids, other, signal) {
      return this.raw.forwardMessages({
        chat_id,
        from_chat_id,
        message_ids,
        ...other
      }, signal);
    }
    copyMessage(chat_id, from_chat_id, message_id, other, signal) {
      return this.raw.copyMessage({ chat_id, from_chat_id, message_id, ...other }, signal);
    }
    copyMessages(chat_id, from_chat_id, message_ids, other, signal) {
      return this.raw.copyMessages({
        chat_id,
        from_chat_id,
        message_ids,
        ...other
      }, signal);
    }
    sendPhoto(chat_id, photo, other, signal) {
      return this.raw.sendPhoto({ chat_id, photo, ...other }, signal);
    }
    sendLivePhoto(chat_id, live_photo, photo, other, signal) {
      return this.raw.sendLivePhoto({ chat_id, live_photo, photo, ...other }, signal);
    }
    sendAudio(chat_id, audio, other, signal) {
      return this.raw.sendAudio({ chat_id, audio, ...other }, signal);
    }
    sendDocument(chat_id, document2, other, signal) {
      return this.raw.sendDocument({ chat_id, document: document2, ...other }, signal);
    }
    sendVideo(chat_id, video, other, signal) {
      return this.raw.sendVideo({ chat_id, video, ...other }, signal);
    }
    sendAnimation(chat_id, animation, other, signal) {
      return this.raw.sendAnimation({ chat_id, animation, ...other }, signal);
    }
    sendVoice(chat_id, voice, other, signal) {
      return this.raw.sendVoice({ chat_id, voice, ...other }, signal);
    }
    sendVideoNote(chat_id, video_note, other, signal) {
      return this.raw.sendVideoNote({ chat_id, video_note, ...other }, signal);
    }
    sendPaidMedia(chat_id, star_count, media, other, signal) {
      return this.raw.sendPaidMedia({ chat_id, star_count, media, ...other }, signal);
    }
    sendMediaGroup(chat_id, media, other, signal) {
      return this.raw.sendMediaGroup({ chat_id, media, ...other }, signal);
    }
    sendLocation(chat_id, latitude, longitude, other, signal) {
      return this.raw.sendLocation({ chat_id, latitude, longitude, ...other }, signal);
    }
    editMessageLiveLocation(chat_id, message_id, latitude, longitude, other, signal) {
      return this.raw.editMessageLiveLocation({ chat_id, message_id, latitude, longitude, ...other }, signal);
    }
    editMessageLiveLocationInline(inline_message_id, latitude, longitude, other, signal) {
      return this.raw.editMessageLiveLocation({ inline_message_id, latitude, longitude, ...other }, signal);
    }
    stopMessageLiveLocation(chat_id, message_id, other, signal) {
      return this.raw.stopMessageLiveLocation({ chat_id, message_id, ...other }, signal);
    }
    stopMessageLiveLocationInline(inline_message_id, other, signal) {
      return this.raw.stopMessageLiveLocation({ inline_message_id, ...other }, signal);
    }
    sendVenue(chat_id, latitude, longitude, title, address, other, signal) {
      return this.raw.sendVenue({ chat_id, latitude, longitude, title, address, ...other }, signal);
    }
    sendContact(chat_id, phone_number, first_name, other, signal) {
      return this.raw.sendContact({ chat_id, phone_number, first_name, ...other }, signal);
    }
    sendPoll(chat_id, question, options, other, signal) {
      const opts = options.map((o) => typeof o === "string" ? { text: o } : o);
      return this.raw.sendPoll({ chat_id, question, options: opts, ...other }, signal);
    }
    sendChecklist(business_connection_id, chat_id, checklist, other, signal) {
      return this.raw.sendChecklist({
        business_connection_id,
        chat_id,
        checklist,
        ...other
      }, signal);
    }
    editMessageChecklist(business_connection_id, chat_id, message_id, checklist, other, signal) {
      return this.raw.editMessageChecklist({
        business_connection_id,
        chat_id,
        message_id,
        checklist,
        ...other
      }, signal);
    }
    sendDice(chat_id, emoji, other, signal) {
      return this.raw.sendDice({ chat_id, emoji, ...other }, signal);
    }
    setMessageReaction(chat_id, message_id, reaction, other, signal) {
      return this.raw.setMessageReaction({
        chat_id,
        message_id,
        reaction,
        ...other
      }, signal);
    }
    sendMessageDraft(chat_id, draft_id, text, other, signal) {
      return this.raw.sendMessageDraft({ chat_id, draft_id, text, ...other }, signal);
    }
    sendRichMessageDraft(chat_id, draft_id, rich_message, other, signal) {
      return this.raw.sendRichMessageDraft({ chat_id, draft_id, rich_message, ...other }, signal);
    }
    sendChatAction(chat_id, action, other, signal) {
      return this.raw.sendChatAction({ chat_id, action, ...other }, signal);
    }
    getUserProfilePhotos(user_id, other, signal) {
      return this.raw.getUserProfilePhotos({ user_id, ...other }, signal);
    }
    getUserProfileAudios(user_id, other, signal) {
      return this.raw.getUserProfileAudios({ user_id, ...other }, signal);
    }
    setUserEmojiStatus(user_id, other, signal) {
      return this.raw.setUserEmojiStatus({ user_id, ...other }, signal);
    }
    getUserChatBoosts(chat_id, user_id, signal) {
      return this.raw.getUserChatBoosts({ chat_id, user_id }, signal);
    }
    getUserGifts(user_id, other, signal) {
      return this.raw.getUserGifts({ user_id, ...other }, signal);
    }
    getChatGifts(chat_id, other, signal) {
      return this.raw.getChatGifts({ chat_id, ...other }, signal);
    }
    getBusinessConnection(business_connection_id, signal) {
      return this.raw.getBusinessConnection({ business_connection_id }, signal);
    }
    getManagedBotToken(user_id, signal) {
      return this.raw.getManagedBotToken({ user_id }, signal);
    }
    replaceManagedBotToken(user_id, signal) {
      return this.raw.replaceManagedBotToken({ user_id }, signal);
    }
    getManagedBotAccessSettings(user_id, signal) {
      return this.raw.getManagedBotAccessSettings({ user_id }, signal);
    }
    setManagedBotAccessSettings(user_id, is_access_restricted, other, signal) {
      return this.raw.setManagedBotAccessSettings({
        user_id,
        is_access_restricted,
        ...other
      }, signal);
    }
    getFile(file_id, signal) {
      return this.raw.getFile({ file_id }, signal);
    }
    kickChatMember(...args) {
      return this.banChatMember(...args);
    }
    banChatMember(chat_id, user_id, other, signal) {
      return this.raw.banChatMember({ chat_id, user_id, ...other }, signal);
    }
    unbanChatMember(chat_id, user_id, other, signal) {
      return this.raw.unbanChatMember({ chat_id, user_id, ...other }, signal);
    }
    restrictChatMember(chat_id, user_id, permissions, other, signal) {
      return this.raw.restrictChatMember({ chat_id, user_id, permissions, ...other }, signal);
    }
    promoteChatMember(chat_id, user_id, other, signal) {
      return this.raw.promoteChatMember({ chat_id, user_id, ...other }, signal);
    }
    setChatAdministratorCustomTitle(chat_id, user_id, custom_title, signal) {
      return this.raw.setChatAdministratorCustomTitle({ chat_id, user_id, custom_title }, signal);
    }
    setChatMemberTag(chat_id, user_id, tag, signal) {
      return this.raw.setChatMemberTag({ chat_id, user_id, tag }, signal);
    }
    banChatSenderChat(chat_id, sender_chat_id, signal) {
      return this.raw.banChatSenderChat({ chat_id, sender_chat_id }, signal);
    }
    unbanChatSenderChat(chat_id, sender_chat_id, signal) {
      return this.raw.unbanChatSenderChat({ chat_id, sender_chat_id }, signal);
    }
    setChatPermissions(chat_id, permissions, other, signal) {
      return this.raw.setChatPermissions({ chat_id, permissions, ...other }, signal);
    }
    exportChatInviteLink(chat_id, signal) {
      return this.raw.exportChatInviteLink({ chat_id }, signal);
    }
    createChatInviteLink(chat_id, other, signal) {
      return this.raw.createChatInviteLink({ chat_id, ...other }, signal);
    }
    editChatInviteLink(chat_id, invite_link, other, signal) {
      return this.raw.editChatInviteLink({ chat_id, invite_link, ...other }, signal);
    }
    createChatSubscriptionInviteLink(chat_id, subscription_period, subscription_price, other, signal) {
      return this.raw.createChatSubscriptionInviteLink({ chat_id, subscription_period, subscription_price, ...other }, signal);
    }
    editChatSubscriptionInviteLink(chat_id, invite_link, other, signal) {
      return this.raw.editChatSubscriptionInviteLink({ chat_id, invite_link, ...other }, signal);
    }
    revokeChatInviteLink(chat_id, invite_link, signal) {
      return this.raw.revokeChatInviteLink({ chat_id, invite_link }, signal);
    }
    approveChatJoinRequest(chat_id, user_id, signal) {
      return this.raw.approveChatJoinRequest({ chat_id, user_id }, signal);
    }
    declineChatJoinRequest(chat_id, user_id, signal) {
      return this.raw.declineChatJoinRequest({ chat_id, user_id }, signal);
    }
    answerChatJoinRequestQuery(chat_join_request_query_id, result, signal) {
      return this.raw.answerChatJoinRequestQuery({ chat_join_request_query_id, result }, signal);
    }
    sendChatJoinRequestWebApp(chat_join_request_query_id, web_app_url, signal) {
      return this.raw.sendChatJoinRequestWebApp({ chat_join_request_query_id, web_app_url }, signal);
    }
    approveSuggestedPost(chat_id, message_id, other, signal) {
      return this.raw.approveSuggestedPost({ chat_id, message_id, ...other }, signal);
    }
    declineSuggestedPost(chat_id, message_id, other, signal) {
      return this.raw.declineSuggestedPost({ chat_id, message_id, ...other }, signal);
    }
    setChatPhoto(chat_id, photo, signal) {
      return this.raw.setChatPhoto({ chat_id, photo }, signal);
    }
    deleteChatPhoto(chat_id, signal) {
      return this.raw.deleteChatPhoto({ chat_id }, signal);
    }
    setChatTitle(chat_id, title, signal) {
      return this.raw.setChatTitle({ chat_id, title }, signal);
    }
    setChatDescription(chat_id, description, signal) {
      return this.raw.setChatDescription({ chat_id, description }, signal);
    }
    pinChatMessage(chat_id, message_id, other, signal) {
      return this.raw.pinChatMessage({ chat_id, message_id, ...other }, signal);
    }
    unpinChatMessage(chat_id, message_id, other, signal) {
      return this.raw.unpinChatMessage({ chat_id, message_id, ...other }, signal);
    }
    unpinAllChatMessages(chat_id, signal) {
      return this.raw.unpinAllChatMessages({ chat_id }, signal);
    }
    leaveChat(chat_id, signal) {
      return this.raw.leaveChat({ chat_id }, signal);
    }
    getChat(chat_id, signal) {
      return this.raw.getChat({ chat_id }, signal);
    }
    getChatAdministrators(chat_id, other, signal) {
      return this.raw.getChatAdministrators({ chat_id, ...other }, signal);
    }
    getChatMembersCount(...args) {
      return this.getChatMemberCount(...args);
    }
    getChatMemberCount(chat_id, signal) {
      return this.raw.getChatMemberCount({ chat_id }, signal);
    }
    getChatMember(chat_id, user_id, signal) {
      return this.raw.getChatMember({ chat_id, user_id }, signal);
    }
    getUserPersonalChatMessages(user_id, limit, signal) {
      return this.raw.getUserPersonalChatMessages({ user_id, limit }, signal);
    }
    setChatStickerSet(chat_id, sticker_set_name, signal) {
      return this.raw.setChatStickerSet({ chat_id, sticker_set_name }, signal);
    }
    deleteChatStickerSet(chat_id, signal) {
      return this.raw.deleteChatStickerSet({ chat_id }, signal);
    }
    getForumTopicIconStickers(signal) {
      return this.raw.getForumTopicIconStickers(signal);
    }
    createForumTopic(chat_id, name, other, signal) {
      return this.raw.createForumTopic({ chat_id, name, ...other }, signal);
    }
    editForumTopic(chat_id, message_thread_id, other, signal) {
      return this.raw.editForumTopic({ chat_id, message_thread_id, ...other }, signal);
    }
    closeForumTopic(chat_id, message_thread_id, signal) {
      return this.raw.closeForumTopic({ chat_id, message_thread_id }, signal);
    }
    reopenForumTopic(chat_id, message_thread_id, signal) {
      return this.raw.reopenForumTopic({ chat_id, message_thread_id }, signal);
    }
    deleteForumTopic(chat_id, message_thread_id, signal) {
      return this.raw.deleteForumTopic({ chat_id, message_thread_id }, signal);
    }
    unpinAllForumTopicMessages(chat_id, message_thread_id, signal) {
      return this.raw.unpinAllForumTopicMessages({ chat_id, message_thread_id }, signal);
    }
    editGeneralForumTopic(chat_id, name, signal) {
      return this.raw.editGeneralForumTopic({ chat_id, name }, signal);
    }
    closeGeneralForumTopic(chat_id, signal) {
      return this.raw.closeGeneralForumTopic({ chat_id }, signal);
    }
    reopenGeneralForumTopic(chat_id, signal) {
      return this.raw.reopenGeneralForumTopic({ chat_id }, signal);
    }
    hideGeneralForumTopic(chat_id, signal) {
      return this.raw.hideGeneralForumTopic({ chat_id }, signal);
    }
    unhideGeneralForumTopic(chat_id, signal) {
      return this.raw.unhideGeneralForumTopic({ chat_id }, signal);
    }
    unpinAllGeneralForumTopicMessages(chat_id, signal) {
      return this.raw.unpinAllGeneralForumTopicMessages({ chat_id }, signal);
    }
    answerCallbackQuery(callback_query_id, other, signal) {
      return this.raw.answerCallbackQuery({ callback_query_id, ...other }, signal);
    }
    answerGuestQuery(guest_query_id, result, signal) {
      return this.raw.answerGuestQuery({ guest_query_id, result }, signal);
    }
    setMyName(name, other, signal) {
      return this.raw.setMyName({ name, ...other }, signal);
    }
    getMyName(other, signal) {
      return this.raw.getMyName(other !== null && other !== undefined ? other : {}, signal);
    }
    setMyCommands(commands, other, signal) {
      return this.raw.setMyCommands({ commands, ...other }, signal);
    }
    deleteMyCommands(other, signal) {
      return this.raw.deleteMyCommands({ ...other }, signal);
    }
    getMyCommands(other, signal) {
      return this.raw.getMyCommands({ ...other }, signal);
    }
    setMyDescription(description, other, signal) {
      return this.raw.setMyDescription({ description, ...other }, signal);
    }
    getMyDescription(other, signal) {
      return this.raw.getMyDescription({ ...other }, signal);
    }
    setMyShortDescription(short_description, other, signal) {
      return this.raw.setMyShortDescription({ short_description, ...other }, signal);
    }
    getMyShortDescription(other, signal) {
      return this.raw.getMyShortDescription({ ...other }, signal);
    }
    setMyProfilePhoto(photo, signal) {
      return this.raw.setMyProfilePhoto({ photo }, signal);
    }
    removeMyProfilePhoto(signal) {
      return this.raw.removeMyProfilePhoto(signal);
    }
    setChatMenuButton(other, signal) {
      return this.raw.setChatMenuButton({ ...other }, signal);
    }
    getChatMenuButton(other, signal) {
      return this.raw.getChatMenuButton({ ...other }, signal);
    }
    setMyDefaultAdministratorRights(other, signal) {
      return this.raw.setMyDefaultAdministratorRights({ ...other }, signal);
    }
    getMyDefaultAdministratorRights(other, signal) {
      return this.raw.getMyDefaultAdministratorRights({ ...other }, signal);
    }
    getMyStarBalance(signal) {
      return this.raw.getMyStarBalance(signal);
    }
    editMessageText(chat_id, message_id, text_or_rich_message, other, signal) {
      return this.raw.editMessageText(typeof text_or_rich_message === "string" ? { chat_id, message_id, text: text_or_rich_message, ...other } : {
        chat_id,
        message_id,
        rich_message: text_or_rich_message,
        ...other
      }, signal);
    }
    editMessageTextInline(inline_message_id, text_or_rich_message, other, signal) {
      return this.raw.editMessageText(typeof text_or_rich_message === "string" ? { inline_message_id, text: text_or_rich_message, ...other } : {
        inline_message_id,
        rich_message: text_or_rich_message,
        ...other
      }, signal);
    }
    editMessageCaption(chat_id, message_id, other, signal) {
      return this.raw.editMessageCaption({ chat_id, message_id, ...other }, signal);
    }
    editMessageCaptionInline(inline_message_id, other, signal) {
      return this.raw.editMessageCaption({ inline_message_id, ...other }, signal);
    }
    editMessageMedia(chat_id, message_id, media, other, signal) {
      return this.raw.editMessageMedia({ chat_id, message_id, media, ...other }, signal);
    }
    editMessageMediaInline(inline_message_id, media, other, signal) {
      return this.raw.editMessageMedia({ inline_message_id, media, ...other }, signal);
    }
    editMessageReplyMarkup(chat_id, message_id, other, signal) {
      return this.raw.editMessageReplyMarkup({ chat_id, message_id, ...other }, signal);
    }
    editMessageReplyMarkupInline(inline_message_id, other, signal) {
      return this.raw.editMessageReplyMarkup({ inline_message_id, ...other }, signal);
    }
    stopPoll(chat_id, message_id, other, signal) {
      return this.raw.stopPoll({ chat_id, message_id, ...other }, signal);
    }
    editEphemeralMessageText(chat_id, receiver_user_id, ephemeral_message_id, text_or_rich_message, other, signal) {
      return this.raw.editEphemeralMessageText(typeof text_or_rich_message === "string" ? {
        chat_id,
        receiver_user_id,
        ephemeral_message_id,
        text: text_or_rich_message,
        ...other
      } : {
        chat_id,
        receiver_user_id,
        ephemeral_message_id,
        rich_message: text_or_rich_message,
        ...other
      }, signal);
    }
    editEphemeralMessageMedia(chat_id, receiver_user_id, ephemeral_message_id, media, other, signal) {
      return this.raw.editEphemeralMessageMedia({
        chat_id,
        receiver_user_id,
        ephemeral_message_id,
        media,
        ...other
      }, signal);
    }
    editEphemeralMessageCaption(chat_id, receiver_user_id, ephemeral_message_id, caption, other, signal) {
      return this.raw.editEphemeralMessageCaption({
        chat_id,
        receiver_user_id,
        ephemeral_message_id,
        caption,
        ...other
      }, signal);
    }
    editEphemeralMessageReplyMarkup(chat_id, receiver_user_id, ephemeral_message_id, other, signal) {
      return this.raw.editEphemeralMessageReplyMarkup({ chat_id, receiver_user_id, ephemeral_message_id, ...other }, signal);
    }
    deleteMessage(chat_id, message_id, signal) {
      return this.raw.deleteMessage({ chat_id, message_id }, signal);
    }
    deleteMessages(chat_id, message_ids, signal) {
      return this.raw.deleteMessages({ chat_id, message_ids }, signal);
    }
    deleteEphemeralMessage(chat_id, receiver_user_id, ephemeral_message_id, signal) {
      return this.raw.deleteEphemeralMessage({ chat_id, receiver_user_id, ephemeral_message_id }, signal);
    }
    deleteMessageReactionUser(chat_id, message_id, user_id, other, signal) {
      return this.raw.deleteMessageReaction({
        chat_id,
        message_id,
        user_id,
        ...other
      }, signal);
    }
    deleteMessageReactionChat(chat_id, message_id, actor_chat_id, other, signal) {
      return this.raw.deleteMessageReaction({
        chat_id,
        message_id,
        actor_chat_id,
        ...other
      }, signal);
    }
    deleteAllMessageReactionsUser(chat_id, user_id, other, signal) {
      return this.raw.deleteAllMessageReactions({
        chat_id,
        user_id,
        ...other
      }, signal);
    }
    deleteAllMessageReactionsChat(chat_id, actor_chat_id, other, signal) {
      return this.raw.deleteAllMessageReactions({
        chat_id,
        actor_chat_id,
        ...other
      }, signal);
    }
    deleteBusinessMessages(business_connection_id, message_ids, signal) {
      return this.raw.deleteBusinessMessages({ business_connection_id, message_ids }, signal);
    }
    setBusinessAccountName(business_connection_id, first_name, other, signal) {
      return this.raw.setBusinessAccountName({ business_connection_id, first_name, ...other }, signal);
    }
    setBusinessAccountUsername(business_connection_id, username, signal) {
      return this.raw.setBusinessAccountUsername({ business_connection_id, username }, signal);
    }
    setBusinessAccountBio(business_connection_id, bio, signal) {
      return this.raw.setBusinessAccountBio({ business_connection_id, bio }, signal);
    }
    setBusinessAccountProfilePhoto(business_connection_id, photo, other, signal) {
      return this.raw.setBusinessAccountProfilePhoto({ business_connection_id, photo, ...other }, signal);
    }
    removeBusinessAccountProfilePhoto(business_connection_id, other, signal) {
      return this.raw.removeBusinessAccountProfilePhoto({ business_connection_id, ...other }, signal);
    }
    setBusinessAccountGiftSettings(business_connection_id, show_gift_button, accepted_gift_types, signal) {
      return this.raw.setBusinessAccountGiftSettings({ business_connection_id, show_gift_button, accepted_gift_types }, signal);
    }
    getBusinessAccountStarBalance(business_connection_id, signal) {
      return this.raw.getBusinessAccountStarBalance({ business_connection_id }, signal);
    }
    transferBusinessAccountStars(business_connection_id, star_count, signal) {
      return this.raw.transferBusinessAccountStars({ business_connection_id, star_count }, signal);
    }
    getBusinessAccountGifts(business_connection_id, other, signal) {
      return this.raw.getBusinessAccountGifts({ business_connection_id, ...other }, signal);
    }
    convertGiftToStars(business_connection_id, owned_gift_id, signal) {
      return this.raw.convertGiftToStars({ business_connection_id, owned_gift_id }, signal);
    }
    upgradeGift(business_connection_id, owned_gift_id, other, signal) {
      return this.raw.upgradeGift({ business_connection_id, owned_gift_id, ...other }, signal);
    }
    transferGift(business_connection_id, owned_gift_id, new_owner_chat_id, star_count, signal) {
      return this.raw.transferGift({
        business_connection_id,
        owned_gift_id,
        new_owner_chat_id,
        star_count
      }, signal);
    }
    postStory(business_connection_id, content, active_period, other, signal) {
      return this.raw.postStory({ business_connection_id, content, active_period, ...other }, signal);
    }
    repostStory(business_connection_id, from_chat_id, from_story_id, active_period, other, signal) {
      return this.raw.repostStory({
        business_connection_id,
        from_chat_id,
        from_story_id,
        active_period,
        ...other
      }, signal);
    }
    editStory(business_connection_id, story_id, content, other, signal) {
      return this.raw.editStory({ business_connection_id, story_id, content, ...other }, signal);
    }
    deleteStory(business_connection_id, story_id, signal) {
      return this.raw.deleteStory({ business_connection_id, story_id }, signal);
    }
    sendSticker(chat_id, sticker, other, signal) {
      return this.raw.sendSticker({ chat_id, sticker, ...other }, signal);
    }
    getStickerSet(name, signal) {
      return this.raw.getStickerSet({ name }, signal);
    }
    getCustomEmojiStickers(custom_emoji_ids, signal) {
      return this.raw.getCustomEmojiStickers({ custom_emoji_ids }, signal);
    }
    uploadStickerFile(user_id, sticker_format, sticker, signal) {
      return this.raw.uploadStickerFile({ user_id, sticker_format, sticker }, signal);
    }
    createNewStickerSet(user_id, name, title, stickers, other, signal) {
      return this.raw.createNewStickerSet({ user_id, name, title, stickers, ...other }, signal);
    }
    addStickerToSet(user_id, name, sticker, signal) {
      return this.raw.addStickerToSet({ user_id, name, sticker }, signal);
    }
    setStickerPositionInSet(sticker, position, signal) {
      return this.raw.setStickerPositionInSet({ sticker, position }, signal);
    }
    deleteStickerFromSet(sticker, signal) {
      return this.raw.deleteStickerFromSet({ sticker }, signal);
    }
    replaceStickerInSet(user_id, name, old_sticker, sticker, signal) {
      return this.raw.replaceStickerInSet({ user_id, name, old_sticker, sticker }, signal);
    }
    setStickerEmojiList(sticker, emoji_list, signal) {
      return this.raw.setStickerEmojiList({ sticker, emoji_list }, signal);
    }
    setStickerKeywords(sticker, keywords, signal) {
      return this.raw.setStickerKeywords({ sticker, keywords }, signal);
    }
    setStickerMaskPosition(sticker, mask_position, signal) {
      return this.raw.setStickerMaskPosition({ sticker, mask_position }, signal);
    }
    setStickerSetTitle(name, title, signal) {
      return this.raw.setStickerSetTitle({ name, title }, signal);
    }
    deleteStickerSet(name, signal) {
      return this.raw.deleteStickerSet({ name }, signal);
    }
    setStickerSetThumbnail(name, user_id, thumbnail, format, signal) {
      return this.raw.setStickerSetThumbnail({ name, user_id, thumbnail, format }, signal);
    }
    setCustomEmojiStickerSetThumbnail(name, custom_emoji_id, signal) {
      return this.raw.setCustomEmojiStickerSetThumbnail({
        name,
        custom_emoji_id
      }, signal);
    }
    getAvailableGifts(signal) {
      return this.raw.getAvailableGifts(signal);
    }
    sendGift(user_id, gift_id, other, signal) {
      return this.raw.sendGift({ user_id, gift_id, ...other }, signal);
    }
    giftPremiumSubscription(user_id, month_count, star_count, other, signal) {
      return this.raw.giftPremiumSubscription({ user_id, month_count, star_count, ...other }, signal);
    }
    sendGiftToChannel(chat_id, gift_id, other, signal) {
      return this.raw.sendGift({ chat_id, gift_id, ...other }, signal);
    }
    answerInlineQuery(inline_query_id, results, other, signal) {
      return this.raw.answerInlineQuery({ inline_query_id, results, ...other }, signal);
    }
    answerWebAppQuery(web_app_query_id, result, signal) {
      return this.raw.answerWebAppQuery({ web_app_query_id, result }, signal);
    }
    savePreparedInlineMessage(user_id, result, other, signal) {
      return this.raw.savePreparedInlineMessage({ user_id, result, ...other }, signal);
    }
    savePreparedKeyboardButton(user_id, button, signal) {
      return this.raw.savePreparedKeyboardButton({ user_id, button }, signal);
    }
    sendInvoice(chat_id, title, description, payload, currency, prices, other, signal) {
      return this.raw.sendInvoice({
        chat_id,
        title,
        description,
        payload,
        currency,
        prices,
        ...other
      }, signal);
    }
    createInvoiceLink(title, description, payload, provider_token, currency, prices, other, signal) {
      return this.raw.createInvoiceLink({
        title,
        description,
        payload,
        provider_token,
        currency,
        prices,
        ...other
      }, signal);
    }
    answerShippingQuery(shipping_query_id, ok, other, signal) {
      return this.raw.answerShippingQuery({ shipping_query_id, ok, ...other }, signal);
    }
    answerPreCheckoutQuery(pre_checkout_query_id, ok, other, signal) {
      return this.raw.answerPreCheckoutQuery({ pre_checkout_query_id, ok, ...other }, signal);
    }
    getStarTransactions(other, signal) {
      return this.raw.getStarTransactions({ ...other }, signal);
    }
    refundStarPayment(user_id, telegram_payment_charge_id, signal) {
      return this.raw.refundStarPayment({ user_id, telegram_payment_charge_id }, signal);
    }
    editUserStarSubscription(user_id, telegram_payment_charge_id, is_canceled, signal) {
      return this.raw.editUserStarSubscription({ user_id, telegram_payment_charge_id, is_canceled }, signal);
    }
    verifyUser(user_id, other, signal) {
      return this.raw.verifyUser({ user_id, ...other }, signal);
    }
    verifyChat(chat_id, other, signal) {
      return this.raw.verifyChat({ chat_id, ...other }, signal);
    }
    removeUserVerification(user_id, signal) {
      return this.raw.removeUserVerification({ user_id }, signal);
    }
    removeChatVerification(chat_id, signal) {
      return this.raw.removeChatVerification({ chat_id }, signal);
    }
    readBusinessMessage(business_connection_id, chat_id, message_id, signal) {
      return this.raw.readBusinessMessage({ business_connection_id, chat_id, message_id }, signal);
    }
    setPassportDataErrors(user_id, errors, signal) {
      return this.raw.setPassportDataErrors({ user_id, errors }, signal);
    }
    sendGame(chat_id, game_short_name, other, signal) {
      return this.raw.sendGame({ chat_id, game_short_name, ...other }, signal);
    }
    setGameScore(chat_id, message_id, user_id, score, other, signal) {
      return this.raw.setGameScore({ chat_id, message_id, user_id, score, ...other }, signal);
    }
    setGameScoreInline(inline_message_id, user_id, score, other, signal) {
      return this.raw.setGameScore({ inline_message_id, user_id, score, ...other }, signal);
    }
    getGameHighScores(chat_id, message_id, user_id, signal) {
      return this.raw.getGameHighScores({ chat_id, message_id, user_id }, signal);
    }
    getGameHighScoresInline(inline_message_id, user_id, signal) {
      return this.raw.getGameHighScores({ inline_message_id, user_id }, signal);
    }
  }
  exports.Api = Api;
});

// runtime/node_modules/grammy/out/bot.js
var require_bot = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.Bot = exports.BotError = exports.DEFAULT_UPDATE_TYPES = undefined;
  var composer_js_1 = require_composer();
  Object.defineProperty(exports, "BotError", { enumerable: true, get: function() {
    return composer_js_1.BotError;
  } });
  var context_js_1 = require_context();
  var api_js_1 = require_api();
  var error_js_1 = require_error();
  var filter_js_1 = require_filter();
  var platform_node_js_1 = require_platform_node();
  var debug = (0, platform_node_js_1.debug)("grammy:bot");
  var debugWarn = (0, platform_node_js_1.debug)("grammy:warn");
  var debugErr = (0, platform_node_js_1.debug)("grammy:error");
  exports.DEFAULT_UPDATE_TYPES = [
    "message",
    "edited_message",
    "channel_post",
    "edited_channel_post",
    "business_connection",
    "business_message",
    "edited_business_message",
    "deleted_business_messages",
    "guest_message",
    "stopped_message_generation",
    "inline_query",
    "chosen_inline_result",
    "callback_query",
    "shipping_query",
    "pre_checkout_query",
    "purchased_paid_media",
    "poll",
    "poll_answer",
    "my_chat_member",
    "managed_bot",
    "chat_join_request",
    "chat_boost",
    "removed_chat_boost",
    "subscription"
  ];

  class Bot extends composer_js_1.Composer {
    constructor(token, config) {
      var _a;
      super();
      this.token = token;
      this.pollingRunning = false;
      this.lastTriedUpdateId = 0;
      this.observedUpdateTypes = new Set;
      this.errorHandler = async (err) => {
        var _a2, _b;
        console.error("Error in middleware while handling update", (_b = (_a2 = err.ctx) === null || _a2 === undefined ? undefined : _a2.update) === null || _b === undefined ? undefined : _b.update_id, err.error);
        console.error("No error handler was set!");
        console.error("Set your own error handler with `bot.catch = ...`");
        if (this.pollingRunning) {
          console.error("Stopping bot");
          await this.stop();
        }
        throw err;
      };
      if (!token)
        throw new Error("Empty token!");
      this.me = config === null || config === undefined ? undefined : config.botInfo;
      this.clientConfig = config === null || config === undefined ? undefined : config.client;
      this.ContextConstructor = (_a = config === null || config === undefined ? undefined : config.ContextConstructor) !== null && _a !== undefined ? _a : context_js_1.Context;
      this.api = new api_js_1.Api(token, this.clientConfig);
    }
    set botInfo(botInfo) {
      this.me = botInfo;
    }
    get botInfo() {
      if (this.me === undefined) {
        throw new Error("Bot information unavailable! Make sure to call `await bot.init()` before accessing `bot.botInfo`!");
      }
      return this.me;
    }
    on(filter, ...middleware) {
      for (const [u] of (0, filter_js_1.parse)(filter).flatMap(filter_js_1.preprocess)) {
        this.observedUpdateTypes.add(u);
      }
      return super.on(filter, ...middleware);
    }
    reaction(reaction, ...middleware) {
      this.observedUpdateTypes.add("message_reaction");
      return super.reaction(reaction, ...middleware);
    }
    isInited() {
      return this.me !== undefined;
    }
    async init(signal) {
      var _a;
      if (!this.isInited()) {
        debug("Initializing bot");
        (_a = this.mePromise) !== null && _a !== undefined || (this.mePromise = withRetries(() => this.api.getMe(signal), signal));
        let me;
        try {
          me = await this.mePromise;
        } finally {
          this.mePromise = undefined;
        }
        if (this.me === undefined)
          this.me = me;
        else
          debug("Bot info was set by now, will not overwrite");
      }
      debug(`I am ${this.me.username}!`);
    }
    async handleUpdates(updates) {
      for (const update of updates) {
        this.lastTriedUpdateId = update.update_id;
        try {
          await this.handleUpdate(update);
        } catch (err) {
          if (err instanceof composer_js_1.BotError) {
            await this.errorHandler(err);
          } else {
            console.error("FATAL: grammY unable to handle:", err);
            throw err;
          }
        }
      }
    }
    async handleUpdate(update, webhookReplyEnvelope) {
      if (this.me === undefined) {
        throw new Error("Bot not initialized! Either call `await bot.init()`, or directly set the `botInfo` option in the `Bot` constructor to specify a known bot info object.");
      }
      debug(`Processing update ${update.update_id}`);
      const api = new api_js_1.Api(this.token, this.clientConfig, webhookReplyEnvelope);
      const t = this.api.config.installedTransformers();
      if (t.length > 0)
        api.config.use(...t);
      const ctx = new this.ContextConstructor(update, api, this.me);
      try {
        await (0, composer_js_1.run)(this.middleware(), ctx);
      } catch (err) {
        debugErr(`Error in middleware for update ${update.update_id}`);
        throw new composer_js_1.BotError(err, ctx);
      }
    }
    async start(options) {
      var _a, _b, _c;
      const setup = [];
      if (!this.isInited()) {
        setup.push(this.init((_a = this.pollingAbortController) === null || _a === undefined ? undefined : _a.signal));
      }
      if (this.pollingRunning) {
        await Promise.all(setup);
        debug("Simple long polling already running!");
        return;
      }
      this.pollingRunning = true;
      this.pollingAbortController = new shim_node_js_1.AbortController;
      setup.push(withRetries(async () => {
        var _a2;
        await this.api.deleteWebhook({
          drop_pending_updates: options === null || options === undefined ? undefined : options.drop_pending_updates
        }, (_a2 = this.pollingAbortController) === null || _a2 === undefined ? undefined : _a2.signal);
      }, (_b = this.pollingAbortController) === null || _b === undefined ? undefined : _b.signal));
      try {
        await Promise.all(setup);
        await ((_c = options === null || options === undefined ? undefined : options.onStart) === null || _c === undefined ? undefined : _c.call(options, this.botInfo));
      } catch (err) {
        this.pollingRunning = false;
        this.pollingAbortController = undefined;
        throw err;
      }
      if (!this.pollingRunning)
        return;
      validateAllowedUpdates(this.observedUpdateTypes, options === null || options === undefined ? undefined : options.allowed_updates);
      this.use = noUseFunction;
      debug("Starting simple long polling");
      await this.loop(options);
      debug("Middleware is done running");
    }
    async stop() {
      var _a;
      if (this.pollingRunning) {
        debug("Stopping bot, saving update offset");
        this.pollingRunning = false;
        (_a = this.pollingAbortController) === null || _a === undefined || _a.abort();
        const offset = this.lastTriedUpdateId + 1;
        await this.api.getUpdates({ offset, limit: 1 }).finally(() => this.pollingAbortController = undefined);
      } else {
        debug("Bot is not running!");
      }
    }
    isRunning() {
      return this.pollingRunning;
    }
    catch(errorHandler) {
      this.errorHandler = errorHandler;
    }
    async loop(options) {
      var _a, _b;
      const limit = options === null || options === undefined ? undefined : options.limit;
      const timeout = (_a = options === null || options === undefined ? undefined : options.timeout) !== null && _a !== undefined ? _a : 30;
      let allowed_updates = (_b = options === null || options === undefined ? undefined : options.allowed_updates) !== null && _b !== undefined ? _b : [];
      try {
        while (this.pollingRunning) {
          const updates = await this.fetchUpdates({ limit, timeout, allowed_updates });
          if (updates === undefined)
            break;
          await this.handleUpdates(updates);
          allowed_updates = undefined;
        }
      } finally {
        this.pollingRunning = false;
      }
    }
    async fetchUpdates({ limit, timeout, allowed_updates }) {
      var _a;
      const offset = this.lastTriedUpdateId + 1;
      let updates = undefined;
      do {
        try {
          updates = await this.api.getUpdates({ offset, limit, timeout, allowed_updates }, (_a = this.pollingAbortController) === null || _a === undefined ? undefined : _a.signal);
        } catch (error) {
          await this.handlePollingError(error);
        }
      } while (updates === undefined && this.pollingRunning);
      return updates;
    }
    async handlePollingError(error) {
      var _a;
      if (!this.pollingRunning) {
        debug("Pending getUpdates request cancelled");
        return;
      }
      let sleepSeconds = 3;
      if (error instanceof error_js_1.GrammyError) {
        debugErr(error.message);
        if (error.error_code === 401 || error.error_code === 409) {
          throw error;
        } else if (error.error_code === 429) {
          debugErr("Bot API server is closing.");
          sleepSeconds = (_a = error.parameters.retry_after) !== null && _a !== undefined ? _a : sleepSeconds;
        }
      } else
        debugErr(error);
      debugErr(`Call to getUpdates failed, retrying in ${sleepSeconds} seconds ...`);
      await sleep(1000 * sleepSeconds);
    }
  }
  exports.Bot = Bot;
  async function withRetries(task, signal) {
    const INITIAL_DELAY = 50;
    let lastDelay = INITIAL_DELAY;
    async function handleError(error) {
      let delay = false;
      let strategy = "rethrow";
      if (error instanceof error_js_1.HttpError) {
        delay = true;
        strategy = "retry";
      } else if (error instanceof error_js_1.GrammyError) {
        if (error.error_code >= 500) {
          delay = true;
          strategy = "retry";
        } else if (error.error_code === 429) {
          const retryAfterSeconds = error.parameters.retry_after;
          if (typeof retryAfterSeconds === "number") {
            await sleep(1000 * retryAfterSeconds, signal);
            lastDelay = INITIAL_DELAY;
          } else {
            delay = true;
          }
          strategy = "retry";
        }
      }
      if (delay) {
        if (lastDelay !== INITIAL_DELAY) {
          await sleep(lastDelay, signal);
        }
        const TWENTY_MINUTES = 20 * 60 * 1000;
        lastDelay = Math.min(TWENTY_MINUTES, 2 * lastDelay);
      }
      return strategy;
    }
    let result = { ok: false };
    while (!result.ok) {
      try {
        result = { ok: true, value: await task() };
      } catch (error) {
        debugErr(error);
        const strategy = await handleError(error);
        switch (strategy) {
          case "retry":
            continue;
          case "rethrow":
            throw error;
        }
      }
    }
    return result.value;
  }
  async function sleep(milliseconds, signal) {
    let handle;
    let reject;
    function abort() {
      reject === null || reject === undefined || reject(new Error("Aborted delay"));
      if (handle !== undefined)
        clearTimeout(handle);
    }
    try {
      await new Promise((res, rej) => {
        reject = rej;
        if (signal === null || signal === undefined ? undefined : signal.aborted) {
          abort();
          return;
        }
        signal === null || signal === undefined || signal.addEventListener("abort", abort);
        handle = setTimeout(res, milliseconds);
      });
    } finally {
      signal === null || signal === undefined || signal.removeEventListener("abort", abort);
    }
  }
  function validateAllowedUpdates(updates, allowed = exports.DEFAULT_UPDATE_TYPES) {
    const impossible = Array.from(updates).filter((u) => !allowed.includes(u));
    if (impossible.length > 0) {
      debugWarn(`You registered listeners for the following update types, but you did not specify them in \`allowed_updates\` so they may not be received: ${impossible.map((u) => `'${u}'`).join(", ")}`);
    }
  }
  function noUseFunction() {
    throw new Error(`It looks like you are registering more listeners on your bot from within other listeners! This means that every time your bot handles a message like this one, new listeners will be added. This list grows until your machine crashes, so grammY throws this error to tell you that you should probably do things a bit differently. If you're unsure how to resolve this problem, you can ask in the group chat: https://telegram.me/grammyjs

On the other hand, if you actually know what you're doing and you do need to install further middleware while your bot is running, consider installing a composer instance on your bot, and in turn augment the composer after the fact. This way, you can circumvent this protection against memory leaks.`);
  }
  var shim_node_js_1 = require_shim_node();
});

// runtime/node_modules/grammy/out/convenience/constants.js
var require_constants = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.API_CONSTANTS = undefined;
  var bot_js_1 = require_bot();
  var ALL_UPDATE_TYPES = [
    ...bot_js_1.DEFAULT_UPDATE_TYPES,
    "chat_member",
    "message_reaction",
    "message_reaction_count"
  ];
  var ALL_CHAT_PERMISSIONS = {
    can_send_messages: true,
    can_send_audios: true,
    can_send_documents: true,
    can_send_photos: true,
    can_send_videos: true,
    can_send_video_notes: true,
    can_send_voice_notes: true,
    can_send_polls: true,
    can_send_other_messages: true,
    can_add_web_page_previews: true,
    can_react_to_messages: true,
    can_change_info: true,
    can_invite_users: true,
    can_edit_tag: true,
    can_pin_messages: true,
    can_manage_topics: true
  };
  exports.API_CONSTANTS = {
    DEFAULT_UPDATE_TYPES: bot_js_1.DEFAULT_UPDATE_TYPES,
    ALL_UPDATE_TYPES,
    ALL_CHAT_PERMISSIONS
  };
  Object.freeze(exports.API_CONSTANTS);
});

// runtime/node_modules/grammy/out/convenience/inline_query.js
var require_inline_query = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.InlineQueryResultBuilder = undefined;
  function inputMessage(queryTemplate) {
    return {
      ...queryTemplate,
      ...inputMessageMethods(queryTemplate)
    };
  }
  function inputMessageMethods(queryTemplate) {
    return {
      text(message_text, options = {}) {
        const content = {
          message_text,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      },
      rich(rich_message, options = {}) {
        const content = {
          rich_message,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      },
      location(latitude, longitude, options = {}) {
        const content = {
          latitude,
          longitude,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      },
      venue(title, latitude, longitude, address, options) {
        const content = {
          title,
          latitude,
          longitude,
          address,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      },
      contact(first_name, phone_number, options = {}) {
        const content = {
          first_name,
          phone_number,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      },
      invoice(title, description, payload, provider_token, currency, prices, options = {}) {
        const content = {
          title,
          description,
          payload,
          provider_token,
          currency,
          prices,
          ...options
        };
        return { ...queryTemplate, input_message_content: content };
      }
    };
  }
  exports.InlineQueryResultBuilder = {
    article(id, title, options = {}) {
      return inputMessageMethods({ type: "article", id, title, ...options });
    },
    audio(id, title, audio_url, options = {}) {
      return inputMessage({
        type: "audio",
        id,
        title,
        audio_url: typeof audio_url === "string" ? audio_url : audio_url.href,
        ...options
      });
    },
    audioCached(id, audio_file_id, options = {}) {
      return inputMessage({ type: "audio", id, audio_file_id, ...options });
    },
    contact(id, phone_number, first_name, options = {}) {
      return inputMessage({ type: "contact", id, phone_number, first_name, ...options });
    },
    documentPdf(id, title, document_url, options = {}) {
      return inputMessage({
        type: "document",
        mime_type: "application/pdf",
        id,
        title,
        document_url: typeof document_url === "string" ? document_url : document_url.href,
        ...options
      });
    },
    documentZip(id, title, document_url, options = {}) {
      return inputMessage({
        type: "document",
        mime_type: "application/zip",
        id,
        title,
        document_url: typeof document_url === "string" ? document_url : document_url.href,
        ...options
      });
    },
    documentCached(id, title, document_file_id, options = {}) {
      return inputMessage({ type: "document", id, title, document_file_id, ...options });
    },
    game(id, game_short_name, options = {}) {
      return { type: "game", id, game_short_name, ...options };
    },
    gif(id, gif_url, thumbnail_url, options = {}) {
      return inputMessage({
        type: "gif",
        id,
        gif_url: typeof gif_url === "string" ? gif_url : gif_url.href,
        thumbnail_url: typeof thumbnail_url === "string" ? thumbnail_url : thumbnail_url.href,
        ...options
      });
    },
    gifCached(id, gif_file_id, options = {}) {
      return inputMessage({ type: "gif", id, gif_file_id, ...options });
    },
    location(id, title, latitude, longitude, options = {}) {
      return inputMessage({ type: "location", id, title, latitude, longitude, ...options });
    },
    mpeg4gif(id, mpeg4_url, thumbnail_url, options = {}) {
      return inputMessage({
        type: "mpeg4_gif",
        id,
        mpeg4_url: typeof mpeg4_url === "string" ? mpeg4_url : mpeg4_url.href,
        thumbnail_url: typeof thumbnail_url === "string" ? thumbnail_url : thumbnail_url.href,
        ...options
      });
    },
    mpeg4gifCached(id, mpeg4_file_id, options = {}) {
      return inputMessage({ type: "mpeg4_gif", id, mpeg4_file_id, ...options });
    },
    photo(id, photo_url, options = {}) {
      const photoUrl = typeof photo_url === "string" ? photo_url : photo_url.href;
      return inputMessage({
        type: "photo",
        id,
        photo_url: photoUrl,
        thumbnail_url: photoUrl,
        ...options
      });
    },
    photoCached(id, photo_file_id, options = {}) {
      return inputMessage({ type: "photo", id, photo_file_id, ...options });
    },
    stickerCached(id, sticker_file_id, options = {}) {
      return inputMessage({ type: "sticker", id, sticker_file_id, ...options });
    },
    venue(id, title, latitude, longitude, address, options = {}) {
      return inputMessage({
        type: "venue",
        id,
        title,
        latitude,
        longitude,
        address,
        ...options
      });
    },
    videoHtml(id, title, video_url, thumbnail_url, options = {}) {
      return inputMessageMethods({
        type: "video",
        mime_type: "text/html",
        id,
        title,
        video_url: typeof video_url === "string" ? video_url : video_url.href,
        thumbnail_url: typeof thumbnail_url === "string" ? thumbnail_url : thumbnail_url.href,
        ...options
      });
    },
    videoMp4(id, title, video_url, thumbnail_url, options = {}) {
      return inputMessage({
        type: "video",
        mime_type: "video/mp4",
        id,
        title,
        video_url: typeof video_url === "string" ? video_url : video_url.href,
        thumbnail_url: typeof thumbnail_url === "string" ? thumbnail_url : thumbnail_url.href,
        ...options
      });
    },
    videoCached(id, title, video_file_id, options = {}) {
      return inputMessage({ type: "video", id, title, video_file_id, ...options });
    },
    voice(id, title, voice_url, options = {}) {
      return inputMessage({
        type: "voice",
        id,
        title,
        voice_url: typeof voice_url === "string" ? voice_url : voice_url.href,
        ...options
      });
    },
    voiceCached(id, title, voice_file_id, options = {}) {
      return inputMessage({ type: "voice", id, title, voice_file_id, ...options });
    }
  };
});

// runtime/node_modules/grammy/out/convenience/input_media.js
var require_input_media = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.InputMediaBuilder = undefined;
  exports.InputMediaBuilder = {
    photo(media, options = {}) {
      return { type: "photo", media, ...options };
    },
    video(media, options = {}) {
      return { type: "video", media, ...options };
    },
    animation(media, options = {}) {
      return { type: "animation", media, ...options };
    },
    audio(media, options = {}) {
      return { type: "audio", media, ...options };
    },
    document(media, options = {}) {
      return { type: "document", media, ...options };
    }
  };
});

// runtime/node_modules/grammy/out/convenience/keyboard.js
var require_keyboard = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.InlineKeyboard = exports.Keyboard = undefined;

  class Keyboard {
    constructor(keyboard = [[]]) {
      this.keyboard = keyboard;
    }
    add(...buttons) {
      var _a;
      (_a = this.keyboard[this.keyboard.length - 1]) === null || _a === undefined || _a.push(...buttons);
      return this;
    }
    row(...buttons) {
      this.keyboard.push(buttons);
      return this;
    }
    text(text, options) {
      return this.add(Keyboard.text(text, options));
    }
    static text(text, options) {
      return typeof options === "string" ? { text, style: options } : { text, ...options };
    }
    requestUsers(text, requestId, options = {}) {
      return this.add(Keyboard.requestUsers(text, requestId, options));
    }
    static requestUsers(text, requestId, options = {}) {
      const request_users = { request_id: requestId, ...options };
      return typeof text === "string" ? { text, request_users } : { ...text, request_users };
    }
    requestChat(text, requestId, options = {
      chat_is_channel: false
    }) {
      return this.add(Keyboard.requestChat(text, requestId, options));
    }
    static requestChat(text, requestId, options = {
      chat_is_channel: false
    }) {
      const request_chat = { request_id: requestId, ...options };
      return typeof text === "string" ? { text, request_chat } : { ...text, request_chat };
    }
    requestContact(text) {
      return this.add(Keyboard.requestContact(text));
    }
    static requestContact(text) {
      const request_contact = true;
      return typeof text === "string" ? { text, request_contact } : { ...text, request_contact };
    }
    requestLocation(text) {
      return this.add(Keyboard.requestLocation(text));
    }
    static requestLocation(text) {
      const request_location = true;
      return typeof text === "string" ? { text, request_location } : { ...text, request_location };
    }
    requestPoll(text, type) {
      return this.add(Keyboard.requestPoll(text, type));
    }
    static requestPoll(text, type) {
      const request_poll = { type };
      return typeof text === "string" ? { text, request_poll } : { ...text, request_poll };
    }
    requestManagedBot(text, requestId, options = {}) {
      return this.add(Keyboard.requestManagedBot(text, requestId, options));
    }
    static requestManagedBot(text, requestId, options = {}) {
      const request_managed_bot = { request_id: requestId, ...options };
      return typeof text === "string" ? { text, request_managed_bot } : { ...text, request_managed_bot };
    }
    webApp(text, url) {
      return this.add(Keyboard.webApp(text, url));
    }
    static webApp(text, url) {
      const web_app = { url };
      return typeof text === "string" ? { text, web_app } : { ...text, web_app };
    }
    style(style) {
      const rows = this.keyboard.length;
      if (rows === 0) {
        throw new Error("Need to add a button before applying a style!");
      }
      const lastRow = this.keyboard[rows - 1];
      const cols = lastRow.length;
      if (cols === 0) {
        throw new Error("Need to add a button before applying a style!");
      }
      let lastButton = lastRow[cols - 1];
      if (typeof lastButton === "string") {
        lastButton = { text: lastButton };
        lastRow[cols - 1] = lastButton;
      }
      lastButton.style = style;
      return this;
    }
    danger() {
      return this.style("danger");
    }
    success() {
      return this.style("success");
    }
    primary() {
      return this.style("primary");
    }
    icon(icon) {
      const rows = this.keyboard.length;
      if (rows === 0) {
        throw new Error("Need to add a button before adding an icon!");
      }
      const lastRow = this.keyboard[rows - 1];
      const cols = lastRow.length;
      if (cols === 0) {
        throw new Error("Need to add a button before adding an icon!");
      }
      let lastButton = lastRow[cols - 1];
      if (typeof lastButton === "string") {
        lastButton = { text: lastButton };
        lastRow[cols - 1] = lastButton;
      }
      lastButton.icon_custom_emoji_id = icon;
      return this;
    }
    persistent(isEnabled = true) {
      this.is_persistent = isEnabled;
      return this;
    }
    selected(isEnabled = true) {
      this.selective = isEnabled;
      return this;
    }
    oneTime(isEnabled = true) {
      this.one_time_keyboard = isEnabled;
      return this;
    }
    resized(isEnabled = true) {
      this.resize_keyboard = isEnabled;
      return this;
    }
    placeholder(value) {
      this.input_field_placeholder = value;
      return this;
    }
    forceReply(isEnabled = true) {
      this.force_reply = isEnabled;
      return this;
    }
    toTransposed() {
      const original = this.keyboard;
      const transposed = transpose(original);
      return this.clone(transposed);
    }
    toFlowed(columns, options = {}) {
      const original = this.keyboard;
      const flowed = reflow(original, columns, options);
      return this.clone(flowed);
    }
    clone(keyboard = this.keyboard) {
      const clone = new Keyboard(keyboard.map((row) => row.slice()));
      clone.is_persistent = this.is_persistent;
      clone.selective = this.selective;
      clone.one_time_keyboard = this.one_time_keyboard;
      clone.resize_keyboard = this.resize_keyboard;
      clone.input_field_placeholder = this.input_field_placeholder;
      clone.force_reply = this.force_reply;
      return clone;
    }
    append(...sources) {
      for (const source of sources) {
        const keyboard = Keyboard.from(source);
        this.keyboard.push(...keyboard.keyboard.map((row) => row.slice()));
      }
      return this;
    }
    build() {
      return this.keyboard;
    }
    static from(source) {
      if (source instanceof Keyboard)
        return source.clone();
      function toButton(btn) {
        return typeof btn === "string" ? Keyboard.text(btn) : btn;
      }
      return new Keyboard(source.map((row) => row.map(toButton)));
    }
  }
  exports.Keyboard = Keyboard;

  class InlineKeyboard {
    constructor(inline_keyboard = [[]]) {
      this.inline_keyboard = inline_keyboard;
    }
    add(...buttons) {
      var _a;
      (_a = this.inline_keyboard[this.inline_keyboard.length - 1]) === null || _a === undefined || _a.push(...buttons);
      return this;
    }
    row(...buttons) {
      this.inline_keyboard.push(buttons);
      return this;
    }
    url(text, url) {
      return this.add(InlineKeyboard.url(text, url));
    }
    static url(text, url) {
      return typeof text === "string" ? { text, url } : { ...text, url };
    }
    text(text, data = typeof text === "string" ? text : text.text) {
      return this.add(InlineKeyboard.text(text, data));
    }
    static text(text, data = typeof text === "string" ? text : text.text) {
      return typeof text === "string" ? { text, callback_data: data } : { ...text, callback_data: data };
    }
    webApp(text, url) {
      return this.add(InlineKeyboard.webApp(text, url));
    }
    static webApp(text, url) {
      const web_app = typeof url === "string" ? { url } : url;
      return typeof text === "string" ? { text, web_app } : { ...text, web_app };
    }
    login(text, loginUrl) {
      return this.add(InlineKeyboard.login(text, loginUrl));
    }
    static login(text, loginUrl) {
      const login_url = typeof loginUrl === "string" ? { url: loginUrl } : loginUrl;
      return typeof text === "string" ? { text, login_url } : { ...text, login_url };
    }
    disabled(text) {
      return this.add(InlineKeyboard.disabled(text));
    }
    static disabled(text) {
      return typeof text === "string" ? { text, disabled: {} } : { ...text, disabled: {} };
    }
    switchInline(text, query = "") {
      return this.add(InlineKeyboard.switchInline(text, query));
    }
    static switchInline(text, query = "") {
      return typeof text === "string" ? { text, switch_inline_query: query } : { ...text, switch_inline_query: query };
    }
    switchInlineCurrent(text, query = "") {
      return this.add(InlineKeyboard.switchInlineCurrent(text, query));
    }
    static switchInlineCurrent(text, query = "") {
      return typeof text === "string" ? { text, switch_inline_query_current_chat: query } : { ...text, switch_inline_query_current_chat: query };
    }
    switchInlineChosen(text, query = {}) {
      return this.add(InlineKeyboard.switchInlineChosen(text, query));
    }
    static switchInlineChosen(text, query = {}) {
      return typeof text === "string" ? { text, switch_inline_query_chosen_chat: query } : { ...text, switch_inline_query_chosen_chat: query };
    }
    copyText(text, copyText) {
      return this.add(InlineKeyboard.copyText(text, copyText));
    }
    static copyText(text, copyText) {
      const copy_text = typeof copyText === "string" ? { text: copyText } : copyText;
      return typeof text === "string" ? { text, copy_text } : { ...text, copy_text };
    }
    game(text) {
      return this.add(InlineKeyboard.game(text));
    }
    static game(text) {
      const callback_game = {};
      return typeof text === "string" ? { text, callback_game } : { ...text, callback_game };
    }
    pay(text) {
      return this.add(InlineKeyboard.pay(text));
    }
    static pay(text) {
      const pay = true;
      return typeof text === "string" ? { text, pay } : { ...text, pay };
    }
    style(style) {
      const rows = this.inline_keyboard.length;
      if (rows === 0) {
        throw new Error("Need to add a button before applying a style!");
      }
      const lastRow = this.inline_keyboard[rows - 1];
      const cols = lastRow.length;
      if (cols === 0) {
        throw new Error("Need to add a button before applying a style!");
      }
      lastRow[cols - 1].style = style;
      return this;
    }
    danger() {
      return this.style("danger");
    }
    success() {
      return this.style("success");
    }
    primary() {
      return this.style("primary");
    }
    icon(icon) {
      const rows = this.inline_keyboard.length;
      if (rows === 0) {
        throw new Error("Need to add a button before adding an icon!");
      }
      const lastRow = this.inline_keyboard[rows - 1];
      const cols = lastRow.length;
      if (cols === 0) {
        throw new Error("Need to add a button before adding an icon!");
      }
      lastRow[cols - 1].icon_custom_emoji_id = icon;
      return this;
    }
    forceReply(isEnabled = true) {
      this.force_reply = isEnabled;
      return this;
    }
    toTransposed() {
      const original = this.inline_keyboard;
      const transposed = transpose(original);
      return this.clone(transposed);
    }
    toFlowed(columns, options = {}) {
      const original = this.inline_keyboard;
      const flowed = reflow(original, columns, options);
      return this.clone(flowed);
    }
    clone(inline_keyboard = this.inline_keyboard) {
      const clone = new InlineKeyboard(inline_keyboard.map((row) => row.slice()));
      clone.force_reply = this.force_reply;
      return clone;
    }
    append(...sources) {
      for (const source of sources) {
        const keyboard = InlineKeyboard.from(source);
        this.inline_keyboard.push(...keyboard.inline_keyboard.map((row) => row.slice()));
      }
      return this;
    }
    static from(source) {
      if (source instanceof InlineKeyboard)
        return source.clone();
      return new InlineKeyboard(source.map((row) => row.slice()));
    }
  }
  exports.InlineKeyboard = InlineKeyboard;
  function transpose(grid) {
    var _a;
    const transposed = [];
    for (let i = 0;i < grid.length; i++) {
      const row = grid[i];
      for (let j = 0;j < row.length; j++) {
        const button = row[j];
        ((_a = transposed[j]) !== null && _a !== undefined ? _a : transposed[j] = []).push(button);
      }
    }
    return transposed;
  }
  function reflow(grid, columns, { fillLastRow = false }) {
    var _a;
    let first = columns;
    if (fillLastRow) {
      const buttonCount = grid.map((row) => row.length).reduce((a, b) => a + b, 0);
      first = buttonCount % columns;
    }
    const reflowed = [];
    for (const row of grid) {
      for (const button of row) {
        const at = Math.max(0, reflowed.length - 1);
        const max = at === 0 ? first : columns;
        let next = (_a = reflowed[at]) !== null && _a !== undefined ? _a : reflowed[at] = [];
        if (next.length === max) {
          next = [];
          reflowed.push(next);
        }
        next.push(button);
      }
    }
    return reflowed;
  }
});

// runtime/node_modules/grammy/out/convenience/session.js
var require_session = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.MemorySessionStorage = undefined;
  exports.session = session;
  exports.lazySession = lazySession;
  exports.enhanceStorage = enhanceStorage;
  var platform_node_js_1 = require_platform_node();
  var debug = (0, platform_node_js_1.debug)("grammy:session");
  function session(options = {}) {
    return options.type === "multi" ? strictMultiSession(options) : strictSingleSession(options);
  }
  function strictSingleSession(options) {
    const { initial, storage, getSessionKey, custom } = fillDefaults(options);
    return async (ctx, next) => {
      const propSession = new PropertySession(storage, ctx, "session", initial);
      const key = await getSessionKey(ctx);
      await propSession.init(key, { custom, lazy: false });
      await next();
      await propSession.finish();
    };
  }
  function strictMultiSession(options) {
    const props = Object.keys(options).filter((k) => k !== "type");
    const defaults = Object.fromEntries(props.map((prop) => [prop, fillDefaults(options[prop])]));
    return async (ctx, next) => {
      ctx.session = {};
      const propSessions = await Promise.all(props.map(async (prop) => {
        const { initial, storage, getSessionKey, custom } = defaults[prop];
        const s = new PropertySession(storage, ctx.session, prop, initial);
        const key = await getSessionKey(ctx);
        await s.init(key, { custom, lazy: false });
        return s;
      }));
      await next();
      if (ctx.session == null)
        propSessions.forEach((s) => s.delete());
      await Promise.all(propSessions.map((s) => s.finish()));
    };
  }
  function lazySession(options = {}) {
    if (options.type !== undefined && options.type !== "single") {
      throw new Error("Cannot use lazy multi sessions!");
    }
    const { initial, storage, getSessionKey, custom } = fillDefaults(options);
    return async (ctx, next) => {
      const propSession = new PropertySession(storage, ctx, "session", initial);
      const key = await getSessionKey(ctx);
      await propSession.init(key, { custom, lazy: true });
      await next();
      await propSession.finish();
    };
  }

  class PropertySession {
    constructor(storage, obj, prop, initial) {
      this.storage = storage;
      this.obj = obj;
      this.prop = prop;
      this.initial = initial;
      this.fetching = false;
      this.read = false;
      this.wrote = false;
    }
    load() {
      if (this.key === undefined) {
        return;
      }
      if (this.wrote) {
        return;
      }
      if (this.promise === undefined) {
        this.fetching = true;
        this.promise = Promise.resolve(this.storage.read(this.key)).then((val) => {
          var _a;
          this.fetching = false;
          if (this.wrote) {
            return this.value;
          }
          if (val !== undefined) {
            this.value = val;
            return val;
          }
          val = (_a = this.initial) === null || _a === undefined ? undefined : _a.call(this);
          if (val !== undefined) {
            this.wrote = true;
            this.value = val;
          }
          return val;
        });
      }
      return this.promise;
    }
    async init(key, opts) {
      this.key = key;
      if (!opts.lazy)
        await this.load();
      Object.defineProperty(this.obj, this.prop, {
        enumerable: true,
        get: () => {
          if (key === undefined) {
            const msg = undef("access", opts);
            throw new Error(msg);
          }
          this.read = true;
          if (!opts.lazy || this.wrote)
            return this.value;
          this.load();
          return this.fetching ? this.promise : this.value;
        },
        set: (v) => {
          if (key === undefined) {
            const msg = undef("assign", opts);
            throw new Error(msg);
          }
          this.wrote = true;
          this.fetching = false;
          this.value = v;
        }
      });
    }
    delete() {
      Object.assign(this.obj, { [this.prop]: undefined });
    }
    async finish() {
      if (this.key !== undefined) {
        if (this.read)
          await this.load();
        if (this.read || this.wrote) {
          const value = await this.value;
          if (value == null)
            await this.storage.delete(this.key);
          else
            await this.storage.write(this.key, value);
        }
      }
    }
  }
  function fillDefaults(opts = {}) {
    let { prefix = "", getSessionKey = defaultGetSessionKey, initial, storage } = opts;
    if (storage == null) {
      debug("Storing session data in memory, all data will be lost when the bot restarts.");
      storage = new MemorySessionStorage;
    }
    const custom = getSessionKey !== defaultGetSessionKey;
    return {
      initial,
      storage,
      getSessionKey: async (ctx) => {
        const key = await getSessionKey(ctx);
        return key === undefined ? undefined : prefix + key;
      },
      custom
    };
  }
  function defaultGetSessionKey(ctx) {
    var _a;
    return (_a = ctx.chatId) === null || _a === undefined ? undefined : _a.toString();
  }
  function undef(op, opts) {
    const { lazy = false, custom } = opts;
    const reason = custom ? "the custom `getSessionKey` function returned undefined for this update" : "this update does not belong to a chat, so the session key is undefined";
    return `Cannot ${op} ${lazy ? "lazy " : ""}session data because ${reason}!`;
  }
  function isEnhance(value) {
    return value === undefined || typeof value === "object" && value !== null && "__d" in value;
  }
  function enhanceStorage(options) {
    let { storage, millisecondsToLive, migrations } = options;
    storage = compatStorage(storage);
    if (millisecondsToLive !== undefined) {
      storage = timeoutStorage(storage, millisecondsToLive);
    }
    if (migrations !== undefined) {
      storage = migrationStorage(storage, migrations);
    }
    return wrapStorage(storage);
  }
  function compatStorage(storage) {
    return {
      read: async (k) => {
        const v = await storage.read(k);
        return isEnhance(v) ? v : { __d: v };
      },
      write: (k, v) => storage.write(k, v),
      delete: (k) => storage.delete(k)
    };
  }
  function timeoutStorage(storage, millisecondsToLive) {
    const ttlStorage = {
      read: async (k) => {
        const value = await storage.read(k);
        if (value === undefined)
          return;
        if (value.e === undefined) {
          await ttlStorage.write(k, value);
          return value;
        }
        if (value.e < Date.now()) {
          await ttlStorage.delete(k);
          return;
        }
        return value;
      },
      write: async (k, v) => {
        v.e = addExpiryDate(v, millisecondsToLive).expires;
        await storage.write(k, v);
      },
      delete: (k) => storage.delete(k)
    };
    return ttlStorage;
  }
  function migrationStorage(storage, migrations) {
    const versions = Object.keys(migrations).map((v) => parseInt(v)).sort((a, b) => a - b);
    const count = versions.length;
    if (count === 0)
      throw new Error("No migrations given!");
    const earliest = versions[0];
    const last = count - 1;
    const latest = versions[last];
    const index = new Map;
    versions.forEach((v, i) => index.set(v, i));
    function nextAfter(current) {
      let i = last;
      while (current <= versions[i])
        i--;
      return i;
    }
    return {
      read: async (k) => {
        var _a;
        const val = await storage.read(k);
        if (val === undefined)
          return val;
        let { __d: value, v: current = earliest - 1 } = val;
        let i = 1 + ((_a = index.get(current)) !== null && _a !== undefined ? _a : nextAfter(current));
        for (;i < count; i++)
          value = migrations[versions[i]](value);
        return { ...val, v: latest, __d: value };
      },
      write: (k, v) => storage.write(k, { v: latest, ...v }),
      delete: (k) => storage.delete(k)
    };
  }
  function wrapStorage(storage) {
    return {
      read: (k) => Promise.resolve(storage.read(k)).then((v) => v === null || v === undefined ? undefined : v.__d),
      write: (k, v) => storage.write(k, { __d: v }),
      delete: (k) => storage.delete(k)
    };
  }

  class MemorySessionStorage {
    constructor(timeToLive) {
      this.timeToLive = timeToLive;
      this.storage = new Map;
    }
    read(key) {
      const value = this.storage.get(key);
      if (value === undefined)
        return;
      if (value.expires !== undefined && value.expires < Date.now()) {
        this.delete(key);
        return;
      }
      return value.session;
    }
    readAll() {
      return this.readAllValues();
    }
    readAllKeys() {
      return Array.from(this.storage.keys());
    }
    readAllValues() {
      return Array.from(this.storage.keys()).map((key) => this.read(key)).filter((value) => value !== undefined);
    }
    readAllEntries() {
      return Array.from(this.storage.keys()).map((key) => [key, this.read(key)]).filter((pair) => pair[1] !== undefined);
    }
    has(key) {
      return this.storage.has(key);
    }
    write(key, value) {
      this.storage.set(key, addExpiryDate(value, this.timeToLive));
    }
    delete(key) {
      this.storage.delete(key);
    }
  }
  exports.MemorySessionStorage = MemorySessionStorage;
  function addExpiryDate(value, ttl) {
    if (ttl !== undefined && ttl < Infinity) {
      const now = Date.now();
      return { session: value, expires: now + ttl };
    } else {
      return { session: value };
    }
  }
});

// runtime/node_modules/grammy/out/convenience/frameworks.js
var require_frameworks = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.adapters = undefined;
  var SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";
  var SECRET_HEADER_LOWERCASE = SECRET_HEADER.toLowerCase();
  var WRONG_TOKEN_ERROR = "secret token is wrong";
  var ok = () => new Response(null, { status: 200 });
  var okJson = (json) => new Response(json, {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
  var unauthorized = () => new Response('"unauthorized"', {
    status: 401,
    statusText: WRONG_TOKEN_ERROR
  });
  var awsLambda = (event, _context, callback) => {
    var _a;
    return {
      get update() {
        var _a2;
        return JSON.parse((_a2 = event.body) !== null && _a2 !== undefined ? _a2 : "{}");
      },
      header: (_a = event.headers[SECRET_HEADER]) !== null && _a !== undefined ? _a : event.headers[SECRET_HEADER_LOWERCASE],
      end: () => callback(null, { statusCode: 200 }),
      respond: (json) => callback(null, {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: json
      }),
      unauthorized: () => callback(null, { statusCode: 401 })
    };
  };
  var awsLambdaAsync = (event, _context) => {
    var _a;
    let resolveResponse;
    return {
      get update() {
        var _a2;
        return JSON.parse((_a2 = event.body) !== null && _a2 !== undefined ? _a2 : "{}");
      },
      header: (_a = event.headers[SECRET_HEADER]) !== null && _a !== undefined ? _a : event.headers[SECRET_HEADER_LOWERCASE],
      end: () => resolveResponse({ statusCode: 200 }),
      respond: (json) => resolveResponse({
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: json
      }),
      unauthorized: () => resolveResponse({ statusCode: 401 }),
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var azure = (context, request) => {
    var _a;
    return {
      get update() {
        return request.body;
      },
      header: (_a = request.headers) === null || _a === undefined ? undefined : _a[SECRET_HEADER_LOWERCASE],
      end: () => context.res = {
        status: 200,
        body: ""
      },
      respond: (json) => {
        var _a2, _b, _c, _d;
        (_b = (_a2 = context.res) === null || _a2 === undefined ? undefined : _a2.set) === null || _b === undefined || _b.call(_a2, "Content-Type", "application/json");
        (_d = (_c = context.res) === null || _c === undefined ? undefined : _c.send) === null || _d === undefined || _d.call(_c, json);
      },
      unauthorized: () => {
        var _a2, _b;
        (_b = (_a2 = context.res) === null || _a2 === undefined ? undefined : _a2.send) === null || _b === undefined || _b.call(_a2, 401, WRONG_TOKEN_ERROR);
      }
    };
  };
  var azureV4 = (request) => {
    let resolveResponse;
    return {
      get update() {
        return request.json();
      },
      header: request.headers.get(SECRET_HEADER) || undefined,
      end: () => resolveResponse({ status: 204 }),
      respond: (json) => resolveResponse({ jsonBody: json }),
      unauthorized: () => resolveResponse({ status: 401, body: WRONG_TOKEN_ERROR }),
      handlerReturn: new Promise((resolve) => resolveResponse = resolve)
    };
  };
  var bun = (request) => {
    let resolveResponse;
    return {
      get update() {
        return request.json();
      },
      header: request.headers.get(SECRET_HEADER) || undefined,
      end: () => {
        resolveResponse(ok());
      },
      respond: (json) => {
        resolveResponse(okJson(json));
      },
      unauthorized: () => {
        resolveResponse(unauthorized());
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var cloudflare = (event) => {
    let resolveResponse;
    event.respondWith(new Promise((resolve) => {
      resolveResponse = resolve;
    }));
    return {
      get update() {
        return event.request.json();
      },
      header: event.request.headers.get(SECRET_HEADER) || undefined,
      end: () => {
        resolveResponse(ok());
      },
      respond: (json) => {
        resolveResponse(okJson(json));
      },
      unauthorized: () => {
        resolveResponse(unauthorized());
      }
    };
  };
  var cloudflareModule = (request) => {
    let resolveResponse;
    return {
      get update() {
        return request.json();
      },
      header: request.headers.get(SECRET_HEADER) || undefined,
      end: () => {
        resolveResponse(ok());
      },
      respond: (json) => {
        resolveResponse(okJson(json));
      },
      unauthorized: () => {
        resolveResponse(unauthorized());
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var express = (req, res) => ({
    get update() {
      return req.body;
    },
    header: req.header(SECRET_HEADER),
    end: () => res.end(),
    respond: (json) => {
      res.set("Content-Type", "application/json");
      res.send(json);
    },
    unauthorized: () => {
      res.status(401).send(WRONG_TOKEN_ERROR);
    }
  });
  var fastify = (request, reply) => ({
    get update() {
      return request.body;
    },
    header: request.headers[SECRET_HEADER_LOWERCASE],
    end: () => reply.send(""),
    respond: (json) => reply.headers({ "Content-Type": "application/json" }).send(json),
    unauthorized: () => reply.code(401).send(WRONG_TOKEN_ERROR)
  });
  var hono = (c) => {
    let resolveResponse;
    return {
      get update() {
        return c.req.json();
      },
      header: c.req.header(SECRET_HEADER),
      end: () => {
        resolveResponse(c.body(""));
      },
      respond: (json) => {
        resolveResponse(c.json(json));
      },
      unauthorized: () => {
        c.status(401);
        resolveResponse(c.body(""));
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var http = (req, res) => {
    const secretHeaderFromRequest = req.headers[SECRET_HEADER_LOWERCASE];
    return {
      get update() {
        return new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", (chunk) => chunks.push(chunk)).once("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            try {
              resolve(JSON.parse(raw));
            } catch (err) {
              reject(err);
            }
          }).once("error", reject);
        });
      },
      header: Array.isArray(secretHeaderFromRequest) ? secretHeaderFromRequest[0] : secretHeaderFromRequest,
      end: () => res.end(),
      respond: (json) => res.writeHead(200, { "Content-Type": "application/json" }).end(json),
      unauthorized: () => res.writeHead(401).end(WRONG_TOKEN_ERROR)
    };
  };
  var koa = (ctx) => ({
    get update() {
      return ctx.request.body;
    },
    header: ctx.get(SECRET_HEADER) || undefined,
    end: () => {
      ctx.body = "";
    },
    respond: (json) => {
      ctx.set("Content-Type", "application/json");
      ctx.response.body = json;
    },
    unauthorized: () => {
      ctx.status = 401;
    }
  });
  var nextJs = (request, response) => ({
    get update() {
      return request.body;
    },
    header: request.headers[SECRET_HEADER_LOWERCASE],
    end: () => response.end(),
    respond: (json) => response.status(200).json(json),
    unauthorized: () => response.status(401).send(WRONG_TOKEN_ERROR)
  });
  var nhttp = (rev) => ({
    get update() {
      return rev.body;
    },
    header: rev.headers.get(SECRET_HEADER) || undefined,
    end: () => rev.response.sendStatus(200),
    respond: (json) => rev.response.status(200).send(json),
    unauthorized: () => rev.response.status(401).send(WRONG_TOKEN_ERROR)
  });
  var oak = (ctx) => ({
    get update() {
      return ctx.request.body.json();
    },
    header: ctx.request.headers.get(SECRET_HEADER) || undefined,
    end: () => {
      ctx.response.status = 200;
    },
    respond: (json) => {
      ctx.response.type = "json";
      ctx.response.body = json;
    },
    unauthorized: () => {
      ctx.response.status = 401;
    }
  });
  var serveHttp = (requestEvent) => ({
    get update() {
      return requestEvent.request.json();
    },
    header: requestEvent.request.headers.get(SECRET_HEADER) || undefined,
    end: () => requestEvent.respondWith(ok()),
    respond: (json) => requestEvent.respondWith(okJson(json)),
    unauthorized: () => requestEvent.respondWith(unauthorized())
  });
  var stdHttp = (req) => {
    let resolveResponse;
    return {
      get update() {
        return req.json();
      },
      header: req.headers.get(SECRET_HEADER) || undefined,
      end: () => {
        if (resolveResponse)
          resolveResponse(ok());
      },
      respond: (json) => {
        if (resolveResponse)
          resolveResponse(okJson(json));
      },
      unauthorized: () => {
        if (resolveResponse)
          resolveResponse(unauthorized());
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var sveltekit = ({ request }) => {
    let resolveResponse;
    return {
      get update() {
        return request.json();
      },
      header: request.headers.get(SECRET_HEADER) || undefined,
      end: () => {
        if (resolveResponse)
          resolveResponse(ok());
      },
      respond: (json) => {
        if (resolveResponse)
          resolveResponse(okJson(json));
      },
      unauthorized: () => {
        if (resolveResponse)
          resolveResponse(unauthorized());
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  var worktop = (req, res) => {
    var _a;
    return {
      get update() {
        return req.json();
      },
      header: (_a = req.headers.get(SECRET_HEADER)) !== null && _a !== undefined ? _a : undefined,
      end: () => res.end(null),
      respond: (json) => res.send(200, json),
      unauthorized: () => res.send(401, WRONG_TOKEN_ERROR)
    };
  };
  var elysia = (ctx) => {
    let resolveResponse;
    return {
      get update() {
        return ctx.body;
      },
      header: ctx.headers[SECRET_HEADER_LOWERCASE],
      end() {
        resolveResponse("");
      },
      respond(json) {
        ctx.set.headers["content-type"] = "application/json";
        resolveResponse(json);
      },
      unauthorized() {
        ctx.set.status = 401;
        resolveResponse("");
      },
      handlerReturn: new Promise((res) => resolveResponse = res)
    };
  };
  exports.adapters = {
    "aws-lambda": awsLambda,
    "aws-lambda-async": awsLambdaAsync,
    azure,
    "azure-v4": azureV4,
    bun,
    cloudflare,
    "cloudflare-mod": cloudflareModule,
    elysia,
    express,
    fastify,
    hono,
    http,
    https: http,
    koa,
    "next-js": nextJs,
    nhttp,
    oak,
    serveHttp,
    "std/http": stdHttp,
    sveltekit,
    worktop
  };
});

// runtime/node_modules/grammy/out/convenience/webhook.js
var require_webhook = __commonJS((exports) => {
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.webhookCallback = webhookCallback;
  var platform_node_js_1 = require_platform_node();
  var frameworks_js_1 = require_frameworks();
  var debugErr = (0, platform_node_js_1.debug)("grammy:error");
  var callbackAdapter = (update, callback, header, unauthorized = () => callback('"unauthorized"')) => ({
    update: Promise.resolve(update),
    respond: callback,
    header,
    unauthorized
  });
  var adapters = { ...frameworks_js_1.adapters, callback: callbackAdapter };
  function compareSecretToken(header, token) {
    if (token === undefined) {
      return true;
    }
    if (header === undefined) {
      return false;
    }
    const encoder = new TextEncoder;
    const headerBytes = encoder.encode(header);
    const tokenBytes = encoder.encode(token);
    if (headerBytes.length !== tokenBytes.length) {
      return false;
    }
    let hasDifference = 0;
    for (let i = 0;i < tokenBytes.length; i++) {
      const headerByte = headerBytes[i];
      const tokenByte = tokenBytes[i];
      hasDifference |= headerByte ^ tokenByte;
    }
    return hasDifference === 0;
  }
  function webhookCallback(bot, adapter = platform_node_js_1.defaultAdapter, onTimeout, timeoutMilliseconds, secretToken) {
    if (bot.isRunning()) {
      throw new Error("Bot is already running via long polling, the webhook setup won't receive any updates!");
    } else {
      bot.start = () => {
        throw new Error("You already started the bot via webhooks, calling `bot.start()` starts the bot with long polling and this will prevent your webhook setup from receiving any updates!");
      };
    }
    const { onTimeout: timeout = "throw", timeoutMilliseconds: ms = 1e4, secretToken: token } = typeof onTimeout === "object" ? onTimeout : { onTimeout, timeoutMilliseconds, secretToken };
    let initialized = false;
    const server = typeof adapter === "string" ? adapters[adapter] : adapter;
    return async (...args) => {
      var _a;
      const handler = server(...args);
      if (!initialized) {
        await bot.init();
        initialized = true;
      }
      if (!compareSecretToken(handler.header, token)) {
        await handler.unauthorized();
        return handler.handlerReturn;
      }
      let usedWebhookReply = false;
      const webhookReplyEnvelope = {
        async send(json) {
          usedWebhookReply = true;
          await handler.respond(json);
        }
      };
      await timeoutIfNecessary(bot.handleUpdate(await handler.update, webhookReplyEnvelope), typeof timeout === "function" ? () => timeout(...args) : timeout, ms);
      if (!usedWebhookReply)
        (_a = handler.end) === null || _a === undefined || _a.call(handler);
      return handler.handlerReturn;
    };
  }
  function timeoutIfNecessary(task, onTimeout, timeout) {
    if (timeout === Infinity)
      return task;
    return new Promise((resolve, reject) => {
      const handle = setTimeout(() => {
        debugErr(`Request timed out after ${timeout} ms`);
        if (onTimeout === "throw") {
          reject(new Error(`Request timed out after ${timeout} ms`));
        } else {
          if (typeof onTimeout === "function")
            onTimeout();
          resolve();
        }
        const now = Date.now();
        task.finally(() => {
          const diff = Date.now() - now;
          debugErr(`Request completed ${diff} ms after timeout!`);
        });
      }, timeout);
      task.then(resolve).catch(reject).finally(() => clearTimeout(handle));
    });
  }
});

// runtime/node_modules/grammy/out/mod.js
var require_mod2 = __commonJS((exports) => {
  var __createBinding = exports && exports.__createBinding || (Object.create ? function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() {
        return m[k];
      } };
    }
    Object.defineProperty(o, k2, desc);
  } : function(o, m, k, k2) {
    if (k2 === undefined)
      k2 = k;
    o[k2] = m[k];
  });
  var __exportStar = exports && exports.__exportStar || function(m, exports2) {
    for (var p in m)
      if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports2, p))
        __createBinding(exports2, m, p);
  };
  Object.defineProperty(exports, "__esModule", { value: true });
  exports.HttpError = exports.GrammyError = exports.Api = exports.matchFilter = exports.Composer = exports.Context = exports.InputFile = exports.BotError = exports.Bot = undefined;
  var bot_js_1 = require_bot();
  Object.defineProperty(exports, "Bot", { enumerable: true, get: function() {
    return bot_js_1.Bot;
  } });
  Object.defineProperty(exports, "BotError", { enumerable: true, get: function() {
    return bot_js_1.BotError;
  } });
  var types_js_1 = require_types();
  Object.defineProperty(exports, "InputFile", { enumerable: true, get: function() {
    return types_js_1.InputFile;
  } });
  var context_js_1 = require_context();
  Object.defineProperty(exports, "Context", { enumerable: true, get: function() {
    return context_js_1.Context;
  } });
  __exportStar(require_constants(), exports);
  __exportStar(require_inline_query(), exports);
  __exportStar(require_input_media(), exports);
  __exportStar(require_keyboard(), exports);
  __exportStar(require_session(), exports);
  __exportStar(require_webhook(), exports);
  var composer_js_1 = require_composer();
  Object.defineProperty(exports, "Composer", { enumerable: true, get: function() {
    return composer_js_1.Composer;
  } });
  var filter_js_1 = require_filter();
  Object.defineProperty(exports, "matchFilter", { enumerable: true, get: function() {
    return filter_js_1.matchFilter;
  } });
  var api_js_1 = require_api();
  Object.defineProperty(exports, "Api", { enumerable: true, get: function() {
    return api_js_1.Api;
  } });
  var error_js_1 = require_error();
  Object.defineProperty(exports, "GrammyError", { enumerable: true, get: function() {
    return error_js_1.GrammyError;
  } });
  Object.defineProperty(exports, "HttpError", { enumerable: true, get: function() {
    return error_js_1.HttpError;
  } });
});

// runtime/src/runtime/atomic-binding-store.ts
import { randomUUID } from "crypto";
import { mkdir, open, readFile, rename, rm } from "fs/promises";
import path2 from "path";

// runtime/src/runtime/binding-registry.ts
import path from "path";

// runtime/src/runtime/identity.ts
function bindingKey(identity) {
  return `${identity.botId}:${identity.chatId}:${identity.threadId}`;
}
function sameBinding(a, b) {
  return a.bindingId === b.bindingId && a.botId === b.botId && a.chatId === b.chatId && a.threadId === b.threadId && a.sessionId === b.sessionId && a.normalizedDirectory === b.normalizedDirectory && a.bindingGeneration === b.bindingGeneration;
}
function sameRun(a, b) {
  return sameBinding(a, b) && a.runId === b.runId && a.workerGeneration === b.workerGeneration;
}

// runtime/src/runtime/binding-registry.ts
class BindingIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "BindingIntegrityError";
  }
}

class BindingRegistry {
  #byId = new Map;
  #byRoute = new Map;
  register(binding) {
    this.#validate(binding);
    if (!Number.isSafeInteger(binding.bindingGeneration) || binding.bindingGeneration < 1) {
      throw new BindingIntegrityError("bindingGeneration must be a positive safe integer");
    }
    const routeKey = bindingKey(binding);
    const existingById = this.#byId.get(binding.bindingId);
    const existingRouteOwner = this.#byRoute.get(routeKey);
    if (existingById && !this.#exact(existingById, binding)) {
      throw new BindingIntegrityError(`bindingId ${binding.bindingId} is ambiguous`);
    }
    if (existingRouteOwner && existingRouteOwner !== binding.bindingId) {
      throw new BindingIntegrityError(`route ${routeKey} has duplicate bindings`);
    }
    this.#byId.set(binding.bindingId, Object.freeze({ ...binding }));
    this.#byRoute.set(routeKey, binding.bindingId);
  }
  replace(binding, expectedGeneration) {
    this.#validate(binding);
    const current = this.#byId.get(binding.bindingId);
    if (!current)
      throw new BindingIntegrityError(`unknown binding ${binding.bindingId}`);
    if (current.bindingGeneration !== expectedGeneration) {
      throw new BindingIntegrityError("binding generation compare-and-swap failed");
    }
    if (current.botId !== binding.botId || current.chatId !== binding.chatId || current.threadId !== binding.threadId) {
      throw new BindingIntegrityError("binding route identity cannot change during replacement");
    }
    if (binding.bindingGeneration <= current.bindingGeneration) {
      throw new BindingIntegrityError("replacement generation must increase monotonically");
    }
    this.#byId.set(binding.bindingId, Object.freeze({ ...binding }));
  }
  getExact(candidate) {
    const stored = this.#byId.get(candidate.bindingId);
    if (!stored || !this.#exact(stored, candidate))
      return null;
    const routeOwner = this.#byRoute.get(bindingKey(candidate));
    return routeOwner === candidate.bindingId ? stored : null;
  }
  getById(bindingId) {
    return this.#byId.get(bindingId) ?? null;
  }
  fence(bindingId) {
    const current = this.#byId.get(bindingId);
    if (!current)
      throw new BindingIntegrityError(`unknown binding ${bindingId}`);
    const next = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1
    });
    this.replace(next, current.bindingGeneration);
    return next;
  }
  remove(bindingId) {
    const current = this.#byId.get(bindingId);
    if (!current)
      return;
    this.#byId.delete(bindingId);
    this.#byRoute.delete(bindingKey(current));
  }
  clear() {
    this.#byId.clear();
    this.#byRoute.clear();
  }
  list() {
    return [...this.#byId.values()];
  }
  #validate(binding) {
    if (!path.isAbsolute(binding.normalizedDirectory) || path.resolve(binding.normalizedDirectory) !== binding.normalizedDirectory) {
      throw new BindingIntegrityError("normalizedDirectory must be an absolute canonical lexical path");
    }
  }
  #exact(a, b) {
    return a.bindingId === b.bindingId && a.botId === b.botId && a.chatId === b.chatId && a.threadId === b.threadId && a.sessionId === b.sessionId && a.normalizedDirectory === b.normalizedDirectory && a.bindingGeneration === b.bindingGeneration;
  }
}

// runtime/src/runtime/atomic-binding-store.ts
class AtomicBindingStore {
  filePath;
  registry = new BindingRegistry;
  #records = new Map;
  #lock = Promise.resolve();
  constructor(filePath) {
    this.filePath = filePath;
  }
  async load() {
    return this.#withLock(() => this.#load());
  }
  async#load() {
    this.#records.clear();
    this.registry.clear();
    let raw;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNotFound(error))
        return;
      throw error;
    }
    const parsed = JSON.parse(raw);
    const records = parseStore(parsed);
    const all = new BindingRegistry;
    for (const record of records) {
      if (this.#records.has(record.binding.bindingId)) {
        throw new BindingIntegrityError("duplicate persisted bindingId " + record.binding.bindingId);
      }
      all.register(record.binding);
      this.#records.set(record.binding.bindingId, record);
      if (record.lifecycle === "ACTIVE") {
        this.registry.register(record.binding);
      }
    }
  }
  async register(binding) {
    return this.#withLock(() => this.#register(binding));
  }
  async#register(binding) {
    if (this.#records.has(binding.bindingId)) {
      throw new BindingIntegrityError("bindingId already exists: " + binding.bindingId);
    }
    const records = new Map(this.#records);
    records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.#validateRecords(records);
    await this.#persist(records);
    this.#records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.registry.register(binding);
  }
  async fence(bindingId) {
    return this.#withLock(() => this.#fence(bindingId));
  }
  async#fence(bindingId) {
    const current = this.registry.getById(bindingId);
    if (!current)
      throw new Error("unknown active binding " + bindingId);
    const next = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1
    });
    await this.#replace(next, current.bindingGeneration);
    return next;
  }
  async replace(binding, expectedGeneration) {
    return this.#withLock(() => this.#replace(binding, expectedGeneration));
  }
  async#replace(binding, expectedGeneration) {
    const record = this.#records.get(binding.bindingId);
    if (!record || record.lifecycle !== "ACTIVE") {
      throw new Error("cannot replace non-active binding " + binding.bindingId);
    }
    const candidateRegistry = this.#activeRegistryClone();
    candidateRegistry.replace(binding, expectedGeneration);
    const records = new Map(this.#records);
    records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.#validateRecords(records);
    await this.#persist(records);
    this.#records.set(binding.bindingId, { lifecycle: "ACTIVE", binding });
    this.registry.replace(binding, expectedGeneration);
  }
  async beginDelete(bindingId) {
    return this.#withLock(() => this.#beginDelete(bindingId));
  }
  async#beginDelete(bindingId) {
    const current = this.registry.getById(bindingId);
    if (!current) {
      const tombstone = this.#records.get(bindingId);
      if (tombstone?.lifecycle === "DELETING")
        return tombstone.binding;
      throw new Error("unknown active binding " + bindingId);
    }
    const fenced = Object.freeze({
      ...current,
      bindingGeneration: current.bindingGeneration + 1
    });
    const records = new Map(this.#records);
    records.set(bindingId, { lifecycle: "DELETING", binding: fenced });
    this.#validateRecords(records);
    await this.#persist(records);
    this.#records.set(bindingId, { lifecycle: "DELETING", binding: fenced });
    this.registry.replace(fenced, current.bindingGeneration);
    this.registry.remove(bindingId);
    return fenced;
  }
  async completeDelete(bindingId) {
    return this.#withLock(() => this.#completeDelete(bindingId));
  }
  async#completeDelete(bindingId) {
    const record = this.#records.get(bindingId);
    if (!record)
      return;
    if (record.lifecycle !== "DELETING") {
      throw new Error("binding is not deleting: " + bindingId);
    }
    const records = new Map(this.#records);
    records.delete(bindingId);
    await this.#persist(records);
    this.#records.delete(bindingId);
  }
  pendingDeletes() {
    return [...this.#records.values()].filter((record) => record.lifecycle === "DELETING").map((record) => record.binding);
  }
  async remove(bindingId) {
    return this.#withLock(() => this.#remove(bindingId));
  }
  async#remove(bindingId) {
    if (this.registry.getById(bindingId))
      await this.#beginDelete(bindingId);
    await this.#completeDelete(bindingId);
  }
  async#withLock(operation) {
    const predecessor = this.#lock;
    let release;
    this.#lock = new Promise((resolve) => {
      release = resolve;
    });
    await predecessor;
    try {
      return await operation();
    } finally {
      release();
    }
  }
  #activeRegistryClone() {
    const clone = new BindingRegistry;
    for (const binding of this.registry.list())
      clone.register(binding);
    return clone;
  }
  #validateRecords(records) {
    const validator = new BindingRegistry;
    for (const record of records.values())
      validator.register(record.binding);
  }
  async#persist(records) {
    const directory = path2.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const tmp = this.filePath + ".tmp-" + process.pid + "-" + randomUUID();
    const handle = await open(tmp, "wx", 384);
    const payload = {
      version: 1,
      records: [...records.values()].sort((a, b) => a.binding.bindingId.localeCompare(b.binding.bindingId))
    };
    try {
      await handle.writeFile(JSON.stringify(payload, null, 2) + `
`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, this.filePath);
      const dir = await open(directory, "r");
      try {
        await dir.sync();
      } finally {
        await dir.close();
      }
    } finally {
      await rm(tmp, { force: true }).catch(() => {
        return;
      });
    }
  }
}
function parseStore(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => ({ lifecycle: "ACTIVE", binding: parseBinding(entry) }));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding store root must be an object");
  }
  const root = value;
  if (root.version !== 1 || !Array.isArray(root.records)) {
    throw new Error("unsupported binding store version");
  }
  return root.records.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("binding record must be an object");
    }
    const record = entry;
    if (record.lifecycle !== "ACTIVE" && record.lifecycle !== "DELETING") {
      throw new Error("invalid binding lifecycle");
    }
    return {
      lifecycle: record.lifecycle,
      binding: parseBinding(record.binding)
    };
  });
}
function parseBinding(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("binding store entry must be an object");
  }
  const record = value;
  for (const field of ["bindingId", "botId", "sessionId", "normalizedDirectory"]) {
    if (typeof record[field] !== "string" || record[field].length === 0) {
      throw new Error("invalid persisted binding field: " + field);
    }
  }
  for (const field of ["chatId", "threadId", "bindingGeneration"]) {
    if (!Number.isSafeInteger(record[field])) {
      throw new Error("invalid persisted binding field: " + field);
    }
  }
  return {
    bindingId: record.bindingId,
    botId: record.botId,
    chatId: record.chatId,
    threadId: record.threadId,
    sessionId: record.sessionId,
    normalizedDirectory: record.normalizedDirectory,
    bindingGeneration: record.bindingGeneration
  };
}
function isNotFound(error) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

// runtime/src/runtime/outbound-gateway.ts
class OutboundGateway {
  bindings;
  runs;
  sink;
  constructor(bindings, runs, sink) {
    this.bindings = bindings;
    this.runs = runs;
    this.sink = sink;
  }
  async dispatch(envelope) {
    if (!this.bindings.getExact(envelope))
      return false;
    if (!this.runs.accepts(envelope))
      return false;
    try {
      const activity = this.runs.activity(envelope);
      do {
        await activity.checkpoint();
      } while (activity.paused);
    } catch {
      return false;
    }
    if (!this.bindings.getExact(envelope) || !this.runs.accepts(envelope))
      return false;
    await this.sink.send(envelope);
    return true;
  }
}

// runtime/src/runtime/liveness-tracker.ts
class RunLivenessTracker {
  runs;
  #states = new Map;
  constructor(runs) {
    this.runs = runs;
  }
  start(run, now = Date.now()) {
    if (!this.runs.accepts(run))
      return false;
    this.#states.set(run.bindingId, {
      run,
      lastActivityAt: this.runs.activity(run).activeTime(now),
      activeTools: new Map
    });
    return true;
  }
  touch(run, now = Date.now()) {
    const state = this.#current(run);
    if (!state)
      return false;
    state.lastActivityAt = this.runs.activity(run).activeTime(now);
    return true;
  }
  toolStarted(run, toolCallId, now = Date.now()) {
    const state = this.#current(run);
    if (!state)
      return false;
    const activeNow = this.runs.activity(run).activeTime(now);
    state.activeTools.set(toolCallId, { startedAt: activeNow });
    state.lastActivityAt = activeNow;
    return true;
  }
  toolFinished(run, toolCallId, now = Date.now()) {
    const state = this.#current(run);
    if (!state)
      return false;
    state.activeTools.delete(toolCallId);
    state.lastActivityAt = this.runs.activity(run).activeTime(now);
    return true;
  }
  assess(run, options) {
    const state = this.#current(run);
    if (!state)
      return "stale";
    if (this.runs.activity(run).paused)
      return "healthy";
    const now = this.runs.activity(run).activeTime(options.now ?? Date.now());
    for (const tool of state.activeTools.values()) {
      if (now - tool.startedAt >= options.toolTimeoutMs)
        return "tool_timeout";
    }
    if (state.activeTools.size > 0)
      return "healthy";
    return now - state.lastActivityAt >= options.stallAfterMs ? "stalled" : "healthy";
  }
  clear(run) {
    const state = this.#current(run);
    if (!state)
      return false;
    this.#states.delete(run.bindingId);
    return true;
  }
  #current(run) {
    if (!this.runs.accepts(run))
      return null;
    const state = this.#states.get(run.bindingId);
    if (!state || state.run.runId !== run.runId || state.run.bindingGeneration !== run.bindingGeneration || state.run.workerGeneration !== run.workerGeneration) {
      return null;
    }
    return state;
  }
}

// runtime/src/runtime/run-registry.ts
import { randomUUID as randomUUID2 } from "crypto";
class RunRegistry {
  #active = new Map;
  start(binding, workerGeneration, runId = randomUUID2()) {
    const run = Object.freeze({ ...binding, workerGeneration, runId });
    const previous = this.#active.get(binding.bindingId);
    const observation = new RunObservation(() => this.#active.get(binding.bindingId)?.observation === observation);
    this.#active.set(binding.bindingId, { run, observation });
    previous?.observation.retire();
    return run;
  }
  startExclusive(binding, workerGeneration, runId = randomUUID2()) {
    if (this.#active.has(binding.bindingId)) {
      throw new Error("binding already owns an active run: " + binding.bindingId);
    }
    return this.start(binding, workerGeneration, runId);
  }
  current(bindingId) {
    return this.#active.get(bindingId)?.run ?? null;
  }
  accepts(candidate) {
    const current = this.#active.get(candidate.bindingId)?.run;
    return current !== undefined && sameBinding(current, candidate) && current.runId === candidate.runId && current.workerGeneration === candidate.workerGeneration;
  }
  finish(candidate) {
    if (!this.accepts(candidate))
      return false;
    const observation = this.#active.get(candidate.bindingId).observation;
    this.#active.delete(candidate.bindingId);
    observation.retire();
    return true;
  }
  fence(bindingId) {
    const observation = this.#active.get(bindingId)?.observation;
    this.#active.delete(bindingId);
    observation?.retire();
  }
  activity(run) {
    if (!this.accepts(run))
      throw new Error("stale runtime execution observation");
    return this.#active.get(run.bindingId).observation;
  }
  observeExecution(run, info, now = Date.now()) {
    if (!this.accepts(run))
      return false;
    if (info.runId !== run.runId || info.continuation !== "live") {
      throw new Error("runtime execution acknowledgment is stale or unavailable");
    }
    this.#active.get(run.bindingId).observation.observe(info.paused, now);
    return true;
  }
  holdExecution(run) {
    if (!this.accepts(run))
      throw new Error("stale runtime execution observation");
    return this.#active.get(run.bindingId).observation.hold();
  }
}

class RunObservation {
  isCurrent;
  #listeners = new Set;
  #waiters = new Set;
  #pausedAt;
  #pausedDuration = 0;
  #retired = false;
  #acknowledgedPause = false;
  #holds = 0;
  #failure;
  constructor(isCurrent) {
    this.isCurrent = isCurrent;
  }
  get paused() {
    return this.#pausedAt !== undefined;
  }
  activeTime(now = Date.now()) {
    return (this.#pausedAt ?? now) - this.#pausedDuration;
  }
  observe(paused, now) {
    this.#assertCurrent();
    this.#acknowledgedPause = paused;
    this.#update(now);
  }
  hold() {
    this.#assertCurrent();
    this.#holds++;
    this.#update(Date.now());
    let released = false;
    return () => {
      if (released || this.#retired)
        return;
      released = true;
      this.#holds--;
      this.#update(Date.now());
    };
  }
  #update(now) {
    const paused = this.#acknowledgedPause || this.#holds > 0;
    if (paused === this.paused)
      return;
    if (paused)
      this.#pausedAt = now;
    else {
      this.#pausedDuration += Math.max(0, now - this.#pausedAt);
      this.#pausedAt = undefined;
    }
    this.#notify();
  }
  subscribe(listener) {
    this.#assertCurrent();
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  async checkpoint(signal) {
    while (true) {
      this.#assertCurrent();
      signal?.throwIfAborted();
      if (!this.paused)
        return;
      await new Promise((resolve, reject) => {
        const cleanup = () => {
          this.#waiters.delete(wake);
          signal?.removeEventListener("abort", abort);
        };
        const wake = () => {
          cleanup();
          resolve();
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        this.#waiters.add(wake);
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted)
          abort();
      });
    }
  }
  retire() {
    this.#retired = true;
    this.#notify(new Error("runtime run observation retired"));
    this.#listeners.clear();
  }
  #assertCurrent() {
    if (this.#failure)
      throw this.#failure;
    if (this.#retired || !this.isCurrent())
      throw new Error("stale runtime execution observation");
  }
  #notify(error) {
    for (const wake of [...this.#waiters])
      wake();
    const failures = [];
    for (const listener of [...this.#listeners]) {
      try {
        listener(error);
      } catch (failure) {
        this.#listeners.delete(listener);
        failures.push(failure);
      }
    }
    if (failures.length > 0 && error === undefined) {
      this.#failure = new AggregateError(failures, "runtime execution observer failed");
      for (const listener of [...this.#listeners]) {
        try {
          listener(this.#failure);
        } catch {}
      }
      this.#listeners.clear();
      throw this.#failure;
    }
  }
}

// runtime/src/runtime/deadline.ts
class DeadlineExceededError extends Error {
  timeoutMs;
  label;
  constructor(timeoutMs, label) {
    super(`${label} exceeded ${timeoutMs}ms deadline`);
    this.timeoutMs = timeoutMs;
    this.label = label;
    this.name = "DeadlineExceededError";
  }
}
function abortableSleep(ms, signal) {
  if (signal?.aborted)
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
async function withDeadline(operation, options) {
  const controller = new AbortController;
  const parent = options.parentSignal;
  parent?.throwIfAborted();
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0)
    throw new Error("deadline must be positive and finite");
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener("abort", onParentAbort, { once: true });
  let timer;
  let unsubscribe;
  let rejectCancellation;
  const cancelled = new Promise((_resolve, reject) => {
    rejectCancellation = reject;
  });
  const onAbort = () => rejectCancellation(controller.signal.reason);
  controller.signal.addEventListener("abort", onAbort, { once: true });
  try {
    const timeout = new Promise((_, reject) => {
      const expire = () => {
        const error = new DeadlineExceededError(options.timeoutMs, options.label);
        controller.abort(error);
        reject(error);
      };
      if (!options.activity) {
        timer = setTimeout(expire, options.timeoutMs);
        return;
      }
      let remaining = options.timeoutMs;
      let startedAt;
      const update = (error) => {
        if (timer !== undefined)
          clearTimeout(timer);
        timer = undefined;
        if (startedAt !== undefined)
          remaining -= Math.max(0, performance.now() - startedAt);
        startedAt = undefined;
        if (error !== undefined) {
          controller.abort(error);
          return;
        }
        if (controller.signal.aborted)
          return;
        if (remaining <= 0) {
          expire();
          return;
        }
        if (options.activity.paused)
          return;
        startedAt = performance.now();
        timer = setTimeout(expire, remaining);
      };
      try {
        unsubscribe = options.activity.subscribe(update);
        update();
      } catch (error) {
        controller.abort(error);
        reject(error);
      }
    });
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return operation(controller.signal);
    });
    const result = await Promise.race([cancelled, timeout, work]);
    controller.signal.throwIfAborted();
    return result;
  } finally {
    if (timer !== undefined)
      clearTimeout(timer);
    unsubscribe?.();
    parent?.removeEventListener("abort", onParentAbort);
    controller.signal.removeEventListener("abort", onAbort);
  }
}

// runtime/src/opencode/execution-client.ts
class OpenCodeExecutionClient {
  runs;
  capture;
  port;
  timeoutMs;
  #controls = new WeakMap;
  constructor(runs, capture, port, timeoutMs) {
    this.runs = runs;
    this.capture = capture;
    this.port = port;
    this.timeoutMs = timeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
      throw new Error("execution control deadline must be positive and finite");
  }
  async request(run, action, signal) {
    signal?.throwIfAborted();
    const owner = Object.freeze({ ...run });
    const captured = this.capture(owner);
    const activity = this.runs.activity(owner);
    let state = this.#controls.get(activity);
    if (!state) {
      state = { tail: Promise.resolve(), uncertain: false };
      this.#controls.set(activity, state);
    }
    if (state.uncertain)
      throw new Error("runtime execution control is uncertain; explicit abort or retirement required");
    const release = this.runs.holdExecution(owner);
    const control = state;
    const pending = control.tail.then(async () => {
      let requested = false;
      try {
        if (control.uncertain)
          throw new Error("runtime execution control is uncertain; explicit abort or retirement required");
        signal?.throwIfAborted();
        if (!this.runs.accepts(owner) || !captured.isCurrent())
          throw new Error("stale runtime execution target");
        const info = await withDeadline((requestSignal) => {
          if (!this.runs.accepts(owner) || !captured.isCurrent())
            throw new Error("stale runtime execution target");
          requested = true;
          return this.port[action](captured.target, requestSignal);
        }, {
          timeoutMs: this.timeoutMs,
          label: "runtime execution " + action,
          ...signal ? { parentSignal: signal } : {}
        });
        if (!this.runs.accepts(owner) || !captured.isCurrent())
          throw new Error("stale runtime execution acknowledgment");
        if (!info || info.runId !== owner.runId || info.continuation !== "live" || typeof info.paused !== "boolean" || action !== "execution" && info.paused !== (action === "pause")) {
          throw new Error("runtime execution acknowledgment is stale or unavailable");
        }
        this.runs.observeExecution(owner, info);
        return Object.freeze({ ...info });
      } catch (error) {
        if (requested)
          control.uncertain = true;
        throw error;
      } finally {
        if (!control.uncertain)
          release();
      }
    });
    control.tail = pending.then(() => {
      return;
    }, () => {
      return;
    });
    return pending;
  }
}

// runtime/src/runtime/stuck-detector.ts
class PerRunStuckDetector {
  runs;
  repeatThreshold;
  #states = new Map;
  constructor(runs, repeatThreshold = 5) {
    this.runs = runs;
    this.repeatThreshold = repeatThreshold;
    if (repeatThreshold < 2)
      throw new Error("repeatThreshold must be >= 2");
  }
  observeTool(run, toolName, args) {
    if (!this.runs.accepts(run))
      return "stale";
    if (this.runs.activity(run).paused)
      return "ok";
    const fingerprint = toolName + ":" + stableJson(args);
    let state = this.#states.get(run.bindingId);
    if (!state || state.runId !== run.runId) {
      state = { runId: run.runId, lastFingerprint: null, repeats: 0 };
      this.#states.set(run.bindingId, state);
    }
    if (state.lastFingerprint === fingerprint) {
      state.repeats += 1;
    } else {
      state.lastFingerprint = fingerprint;
      state.repeats = 1;
    }
    return state.repeats >= this.repeatThreshold ? "stuck" : "ok";
  }
  markProgress(run) {
    if (!this.runs.accepts(run))
      return false;
    this.#states.set(run.bindingId, {
      runId: run.runId,
      lastFingerprint: null,
      repeats: 0
    });
    return true;
  }
  clear(run) {
    const state = this.#states.get(run.bindingId);
    if (state?.runId === run.runId)
      this.#states.delete(run.bindingId);
  }
}
function stableJson(value) {
  return JSON.stringify(normalize(value));
}
function normalize(value) {
  if (Array.isArray(value))
    return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, normalize(item)]));
  }
  return value;
}

// runtime/src/runtime/worker-supervisor.ts
class WorkerSupervisor {
  factory;
  options;
  #workers = new Map;
  #generation = new Map;
  #pending = new Map;
  #retiring = new Map;
  #lifecycleEpoch = new Map;
  #reservedStarts = 0;
  constructor(factory, options) {
    this.factory = factory;
    this.options = options;
    if (options.maxWorkers < 1)
      throw new Error("maxWorkers must be >= 1");
  }
  async ensure(binding) {
    const retiring = this.#retiring.get(binding.bindingId);
    if (retiring) {
      await retiring.promise;
      return this.ensure(binding);
    }
    const existing = this.#workers.get(binding.bindingId);
    if (existing) {
      this.#assertSameBinding(existing.binding, binding);
      existing.lastUsedAt = Date.now();
      return existing.worker;
    }
    const inflight = this.#pending.get(binding.bindingId);
    if (inflight) {
      this.#assertSameBinding(inflight.binding, binding);
      return inflight.promise;
    }
    const state = {
      binding: Object.freeze({ ...binding }),
      cancelled: false,
      promise: undefined
    };
    const creation = Promise.resolve().then(() => this.#create(state));
    state.promise = creation;
    this.#pending.set(binding.bindingId, state);
    try {
      return await creation;
    } finally {
      if (this.#pending.get(binding.bindingId) === state) {
        this.#pending.delete(binding.bindingId);
      }
    }
  }
  async replace(binding, reason) {
    await this.stop(binding.bindingId, reason);
    return this.ensure(binding);
  }
  async stop(bindingId, reason) {
    this.#bumpLifecycleEpoch(bindingId);
    const pending = this.#pending.get(bindingId);
    if (pending)
      pending.cancelled = true;
    const existingRetirement = this.#retiring.get(bindingId);
    const slot = this.#workers.get(bindingId);
    if (slot) {
      this.#workers.delete(bindingId);
      await this.#retire(slot, reason).promise;
    } else if (existingRetirement) {
      await existingRetirement.promise;
    }
    if (pending) {
      await pending.promise.catch(() => {
        return;
      });
    }
  }
  async stopIfCurrent(binding, worker, reason) {
    const slot = this.#workers.get(binding.bindingId);
    if (!slot || slot.worker !== worker || !sameBinding(slot.binding, binding)) {
      return false;
    }
    this.#bumpLifecycleEpoch(binding.bindingId);
    this.#workers.delete(binding.bindingId);
    await this.#retire(slot, reason).promise;
    return true;
  }
  async workerCrashed(binding, workerGeneration) {
    const slot = this.#workers.get(binding.bindingId);
    if (!slot || slot.worker.generation !== workerGeneration || !sameBinding(slot.binding, binding)) {
      throw new Error("stale worker crash notification");
    }
    const lifecycleEpoch = this.#lifecycleEpoch.get(binding.bindingId) ?? 0;
    this.#workers.delete(binding.bindingId);
    await this.#retire(slot, "worker_crashed").promise;
    if ((this.#lifecycleEpoch.get(binding.bindingId) ?? 0) !== lifecycleEpoch) {
      throw new Error("worker crash recovery superseded by lifecycle change");
    }
    return this.ensure(binding);
  }
  isCurrent(binding, worker) {
    const slot = this.#workers.get(binding.bindingId);
    return Boolean(slot && slot.worker === worker && sameBinding(slot.binding, binding));
  }
  complete(run) {
    const slot = this.#workers.get(run.bindingId);
    if (!slot || slot.worker.generation !== run.workerGeneration || !sameBinding(slot.binding, run))
      return;
    slot.worker.complete?.(run);
  }
  current(run) {
    const slot = this.#workers.get(run.bindingId);
    return slot && slot.worker.generation === run.workerGeneration && sameBinding(slot.binding, run) ? slot.worker : null;
  }
  size() {
    return this.#workers.size + this.#reservedStarts + this.#unclaimedRetirementCount();
  }
  idleCount() {
    return [...this.#workers.values()].filter((slot) => slot.worker.idle).length;
  }
  async evictOldestIdle(reason) {
    const idle = [...this.#workers.values()].filter((slot) => slot.worker.idle).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!idle)
      return false;
    this.#bumpLifecycleEpoch(idle.binding.bindingId);
    this.#workers.delete(idle.binding.bindingId);
    await this.#retire(idle, reason).promise;
    return true;
  }
  async stopAll(reason) {
    const bindingIds = new Set([
      ...this.#workers.keys(),
      ...this.#pending.keys(),
      ...this.#retiring.keys()
    ]);
    await Promise.all([...bindingIds].map((bindingId) => this.stop(bindingId, reason)));
  }
  async#create(state) {
    if (state.cancelled)
      throw new Error("worker creation cancelled before start");
    const eviction = this.#reserveSlot();
    try {
      if (eviction) {
        await eviction;
      }
      if (state.cancelled) {
        throw new Error("worker creation cancelled before start");
      }
      const binding = state.binding;
      const generation = (this.#generation.get(binding.bindingId) ?? 0) + 1;
      this.#generation.set(binding.bindingId, generation);
      const worker = this.factory(binding, generation);
      try {
        await worker.start(binding);
      } catch (error) {
        await worker.stop("worker_start_failed").catch(() => {
          return;
        });
        throw error;
      }
      if (state.cancelled) {
        await worker.stop("worker_creation_cancelled").catch(() => {
          return;
        });
        throw new Error("worker creation cancelled during start");
      }
      this.#workers.set(binding.bindingId, {
        worker,
        binding,
        lastUsedAt: Date.now()
      });
      return worker;
    } finally {
      this.#reservedStarts -= 1;
    }
  }
  #reserveSlot() {
    const occupied = this.#workers.size + this.#reservedStarts + this.#unclaimedRetirementCount();
    if (occupied < this.options.maxWorkers) {
      this.#reservedStarts += 1;
      return null;
    }
    const retirement = [...this.#retiring.values()].find((entry) => !entry.capacityClaimed);
    if (retirement) {
      retirement.capacityClaimed = true;
      this.#reservedStarts += 1;
      return retirement.promise;
    }
    const idle = [...this.#workers.values()].filter((slot) => slot.worker.idle).sort((a, b) => a.lastUsedAt - b.lastUsedAt)[0];
    if (!idle) {
      throw new Error("worker capacity exhausted: no idle worker can be evicted");
    }
    this.#workers.delete(idle.worker.bindingId);
    this.#reservedStarts += 1;
    return this.#retire(idle, "railway_resource_budget", true).promise;
  }
  #retire(slot, reason, capacityClaimed = false) {
    const bindingId = slot.binding.bindingId;
    const existing = this.#retiring.get(bindingId);
    if (existing) {
      if (capacityClaimed)
        existing.capacityClaimed = true;
      return existing;
    }
    const retirement = {
      promise: undefined,
      capacityClaimed
    };
    retirement.promise = Promise.resolve().then(() => slot.worker.stop(reason)).finally(() => {
      if (this.#retiring.get(bindingId) === retirement) {
        this.#retiring.delete(bindingId);
      }
    });
    this.#retiring.set(bindingId, retirement);
    return retirement;
  }
  #unclaimedRetirementCount() {
    let count = 0;
    for (const retirement of this.#retiring.values()) {
      if (!retirement.capacityClaimed)
        count += 1;
    }
    return count;
  }
  #bumpLifecycleEpoch(bindingId) {
    this.#lifecycleEpoch.set(bindingId, (this.#lifecycleEpoch.get(bindingId) ?? 0) + 1);
  }
  #assertSameBinding(actual, expected) {
    if (!sameBinding(actual, expected)) {
      throw new Error("worker binding identity mismatch; stop or replace the stale worker before reuse");
    }
  }
}

// runtime/src/ipc/worker-outbound-gate.ts
class WorkerProtocolError extends Error {
  constructor(message) {
    super(message);
    this.name = "WorkerProtocolError";
  }
}

class WorkerOutboundGate {
  lease;
  gateway;
  constructor(lease, gateway) {
    this.lease = lease;
    this.gateway = gateway;
  }
  async accept(value) {
    const envelope = parseOutboundEnvelope(value);
    if (envelope.bindingId !== this.lease.bindingId || envelope.workerGeneration !== this.lease.workerGeneration) {
      return false;
    }
    return this.gateway.dispatch(envelope);
  }
}
function parseOutboundEnvelope(value) {
  if (!isRecord(value))
    throw new WorkerProtocolError("outbound envelope must be an object");
  const requiredStrings = [
    "bindingId",
    "botId",
    "sessionId",
    "normalizedDirectory",
    "runId",
    "operationId",
    "kind"
  ];
  for (const field of requiredStrings) {
    if (typeof value[field] !== "string" || value[field].length === 0) {
      throw new WorkerProtocolError("invalid outbound envelope field: " + field);
    }
  }
  const requiredIntegers = [
    "chatId",
    "threadId",
    "bindingGeneration",
    "workerGeneration"
  ];
  for (const field of requiredIntegers) {
    if (!Number.isSafeInteger(value[field])) {
      throw new WorkerProtocolError("invalid outbound envelope field: " + field);
    }
  }
  if (value.bindingGeneration < 1 || value.workerGeneration < 1) {
    throw new WorkerProtocolError("generations must be positive");
  }
  if (!Object.hasOwn(value, "payload")) {
    throw new WorkerProtocolError("outbound envelope payload is required");
  }
  return Object.freeze({
    bindingId: value.bindingId,
    botId: value.botId,
    chatId: value.chatId,
    threadId: value.threadId,
    sessionId: value.sessionId,
    normalizedDirectory: value.normalizedDirectory,
    bindingGeneration: value.bindingGeneration,
    runId: value.runId,
    workerGeneration: value.workerGeneration,
    operationId: value.operationId,
    kind: value.kind,
    payload: value.payload
  });
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// runtime/src/opencode/session-event-router.ts
var MAX_PARENT_DEPTH = 32;
var PARENT_CACHE_LIMIT = 1024;

class SessionEventRouter {
  bindings;
  runs;
  lookupParent;
  lookupTimeoutMs;
  #parents = new Map;
  constructor(bindings, runs, lookupParent, lookupTimeoutMs = 1e4) {
    this.bindings = bindings;
    this.runs = runs;
    this.lookupParent = lookupParent;
    this.lookupTimeoutMs = lookupTimeoutMs;
  }
  async resolve(sessionId, normalizedDirectory) {
    const snapshot = this.bindings.list();
    const inDirectory = snapshot.filter((binding) => normalizedDirectory !== null && binding.normalizedDirectory === normalizedDirectory);
    if (!sessionId)
      return inDirectory.length === 1 ? this.bindings.getExact(inDirectory[0]) : null;
    const known = snapshot.filter((binding) => binding.sessionId === sessionId);
    if (known.length > 0) {
      const exact = known.filter((binding) => !normalizedDirectory || binding.normalizedDirectory === normalizedDirectory);
      return exact.length === 1 ? this.bindings.getExact(exact[0]) : null;
    }
    if (!normalizedDirectory || !this.lookupParent)
      return null;
    const owners = inDirectory.flatMap((binding) => {
      const run = this.runs.current(binding.bindingId);
      return run && sameBinding(run, binding) ? [{ binding, run }] : [];
    });
    if (owners.length === 0)
      return null;
    try {
      return await withDeadline(async (signal) => {
        const visited = new Set;
        let current = sessionId;
        for (let depth = 0;depth < MAX_PARENT_DEPTH; depth += 1) {
          if (visited.has(current))
            return null;
          visited.add(current);
          const parent = await this.#parent(current, normalizedDirectory, signal);
          if (!parent)
            return null;
          const ancestors = snapshot.filter((binding) => binding.sessionId === parent);
          if (ancestors.length > 0) {
            if (ancestors.filter((binding) => binding.normalizedDirectory === normalizedDirectory).length !== 1)
              return null;
            const matches = owners.filter((owner2) => owner2.binding.sessionId === parent);
            if (matches.length !== 1)
              return null;
            const owner = matches[0];
            return this.runs.accepts(owner.run) ? this.bindings.getExact(owner.binding) : null;
          }
          current = parent;
        }
        return null;
      }, { timeoutMs: this.lookupTimeoutMs, label: "session event ancestry" });
    } catch {
      return null;
    }
  }
  async#parent(sessionId, directory, signal) {
    signal.throwIfAborted();
    const key = JSON.stringify([directory, sessionId]);
    if (this.#parents.has(key))
      return this.#parents.get(key);
    const parent = await this.lookupParent(sessionId, directory, signal);
    signal.throwIfAborted();
    if (parent !== null && (typeof parent !== "string" || parent.length === 0)) {
      throw new Error("invalid session parent identity");
    }
    this.#parents.set(key, parent);
    if (this.#parents.size > PARENT_CACHE_LIMIT)
      this.#parents.delete(this.#parents.keys().next().value);
    return parent;
  }
}

// runtime/src/runtime/serial-task-queue.ts
class QueuePoisonedError extends Error {
  rootCause;
  constructor(message, rootCause) {
    super(message);
    this.rootCause = rootCause;
    this.name = "QueuePoisonedError";
  }
}

class SerialTaskQueue {
  options;
  #tail = Promise.resolve();
  #poisoned = null;
  constructor(options) {
    this.options = options;
  }
  get poisoned() {
    return this.#poisoned !== null;
  }
  enqueue(label, task, timeoutMs = this.options.defaultTimeoutMs, activity) {
    if (this.#poisoned)
      return Promise.reject(this.#poisoned);
    let resolveResult;
    let rejectResult;
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve;
      rejectResult = reject;
    });
    this.#tail = this.#tail.then(async () => {
      if (this.#poisoned) {
        rejectResult(this.#poisoned);
        return;
      }
      const controller = new AbortController;
      let taskSettled = true;
      let taskPromise = Promise.resolve();
      try {
        resolveResult(await withDeadline(() => {
          taskSettled = false;
          const started = (async () => task(controller.signal))().finally(() => {
            taskSettled = true;
          });
          taskPromise = started;
          return started;
        }, {
          timeoutMs,
          label: `queue task ${label}`,
          parentSignal: controller.signal,
          ...activity ? { activity } : {}
        }));
      } catch (error) {
        controller.abort(error);
        if (!taskSettled) {
          await Promise.race([
            taskPromise.then(() => {
              return;
            }, () => {
              return;
            }),
            new Promise((resolve) => setTimeout(resolve, this.options.cancellationGraceMs))
          ]);
          if (!taskSettled) {
            const poison = new QueuePoisonedError(`task ${label} ignored cancellation; isolation boundary must be replaced before queue reuse`, error);
            this.#poisoned = poison;
            rejectResult(poison);
            Promise.resolve().then(() => this.options.onUncooperativeTask?.(poison)).catch(() => {
              return;
            });
            return;
          }
        }
        rejectResult(error);
      }
    });
    return result;
  }
}

// runtime/src/opencode/topic-worker.ts
import path4 from "path";

// runtime/src/opencode/temporary-session.ts
import path3 from "path";
class TemporarySessionRunner {
  port;
  cleanupTimeoutMs;
  constructor(port, cleanupTimeoutMs = 5000) {
    this.port = port;
    this.cleanupTimeoutMs = cleanupTimeoutMs;
    if (!Number.isFinite(cleanupTimeoutMs) || cleanupTimeoutMs <= 0)
      throw new Error("temporary session cleanup deadline must be positive");
  }
  async run(inputOwner, options, operation, signal, lifecycle) {
    signal.throwIfAborted();
    if (!inputOwner.sessionId.trim() || !inputOwner.directory.trim())
      throw new Error("temporary session requires an exact owner");
    const owner = Object.freeze({ sessionId: inputOwner.sessionId, directory: path3.resolve(inputOwner.directory) });
    const verified = await this.port.get(owner, signal);
    signal.throwIfAborted();
    if (verified.sessionId !== owner.sessionId || path3.resolve(verified.directory) !== owner.directory) {
      throw new Error("temporary session owner identity mismatch");
    }
    const created = await this.port.create(owner, options, signal);
    if (!created.sessionId.trim() || created.sessionId === owner.sessionId || created.parentSessionId !== owner.sessionId || path3.resolve(created.directory) !== owner.directory) {
      throw new Error("temporary session identity mismatch");
    }
    const session = Object.freeze({ ...created, directory: owner.directory });
    let retained = false;
    let acquired = false;
    let completed = false;
    try {
      signal.throwIfAborted();
      lifecycle?.acquire(session);
      acquired = true;
      if (lifecycle?.activity)
        do {
          await lifecycle.activity.checkpoint(signal);
        } while (lifecycle.activity.paused);
      const result = await operation(Object.freeze({
        ...session,
        signal,
        retainForInspection: () => {
          signal.throwIfAborted();
          retained = true;
        }
      }));
      signal.throwIfAborted();
      completed = true;
      return result;
    } finally {
      const failures = [];
      let completionError;
      try {
        while (true) {
          if (completed && !signal.aborted && lifecycle?.activity) {
            try {
              await lifecycle.activity.checkpoint(signal);
            } catch (error) {
              completionError = error;
              completed = false;
            }
          }
          const stopped = await withDeadline((cleanupSignal) => {
            if (completed && !signal.aborted && lifecycle?.activity?.paused)
              return Promise.resolve(false);
            lifecycle?.beginCleanup?.();
            return this.port.abort(session, cleanupSignal).then(() => true);
          }, { timeoutMs: this.cleanupTimeoutMs, label: "temporary session cleanup" });
          if (stopped)
            break;
        }
      } catch (error) {
        failures.push(error);
      }
      if (!retained || signal.aborted || failures.length > 0) {
        try {
          await withDeadline((cleanupSignal) => this.port.remove(session, cleanupSignal), { timeoutMs: this.cleanupTimeoutMs, label: "temporary session deletion" });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) {
        const error = new AggregateError(failures, "temporary session cleanup failed");
        lifecycle?.cleanupFailed?.(error);
        throw error;
      }
      if (acquired)
        lifecycle?.release();
      if (completionError !== undefined)
        throw completionError;
    }
  }
}

// runtime/src/runtime/result-poller.ts
class StalePollRunError extends Error {
  constructor() {
    super("polling run is no longer current");
    this.name = "StalePollRunError";
  }
}

class PollAttemptsExceededError extends Error {
  maxAttempts;
  constructor(maxAttempts) {
    super(`result polling reached its ${maxAttempts} attempt limit`);
    this.maxAttempts = maxAttempts;
    this.name = "PollAttemptsExceededError";
  }
}
async function pollRunResult(inputRun, read, options) {
  if (!Number.isSafeInteger(options.maxAttempts) || options.maxAttempts < 1)
    throw new Error("polling attempts must be a positive integer");
  if (!Number.isFinite(options.intervalMs) || options.intervalMs <= 0)
    throw new Error("polling interval must be positive and finite");
  const run = Object.freeze({ ...inputRun });
  const check = (signal) => {
    signal.throwIfAborted();
    if (!options.isCurrent(run))
      throw new StalePollRunError;
  };
  check(options.signal);
  return withDeadline(async (signal) => {
    for (let attempt = 0;attempt < options.maxAttempts; attempt++) {
      check(signal);
      do {
        await options.checkpoint?.(signal);
        check(signal);
      } while (options.checkpoint && options.activity?.paused);
      const outcome = await read(signal);
      check(signal);
      do {
        await options.checkpoint?.(signal);
        check(signal);
      } while (options.checkpoint && options.activity?.paused);
      if (outcome.status === "complete")
        return outcome.value;
      if (outcome.status === "failed")
        throw outcome.error;
      const delay = outcome.retryAfterMs ?? options.intervalMs;
      if (!Number.isFinite(delay) || delay <= 0)
        throw new Error("polling delay must be positive and finite");
      if (attempt + 1 < options.maxAttempts)
        await abortableSleep(Math.min(delay, options.intervalMs), signal);
    }
    throw new PollAttemptsExceededError(options.maxAttempts);
  }, {
    timeoutMs: options.timeoutMs,
    label: "result polling",
    parentSignal: options.signal,
    ...options.activity ? { activity: options.activity } : {}
  });
}

// runtime/src/opencode/topic-worker.ts
class WorkerStopTimeoutError extends Error {
  bindingId;
  timeoutMs;
  constructor(bindingId, timeoutMs) {
    super(`worker ${bindingId} did not stop within ${timeoutMs}ms`);
    this.bindingId = bindingId;
    this.timeoutMs = timeoutMs;
    this.name = "WorkerStopTimeoutError";
  }
}

class OpenCodeTopicWorker {
  client;
  options;
  bindingId;
  generation;
  #started = false;
  #stopped = false;
  #poisoned = false;
  #binding;
  #activeRun = null;
  #activeAbortTarget = null;
  #targetClosing = false;
  #ownedTask = null;
  #controller = new AbortController;
  #inFlight = new Set;
  #queue;
  constructor(binding, generation, client, options) {
    this.client = client;
    this.options = options;
    this.bindingId = binding.bindingId;
    this.generation = generation;
    this.#binding = binding;
    this.#queue = new SerialTaskQueue({
      defaultTimeoutMs: options.promptTimeoutMs,
      cancellationGraceMs: options.cancellationGraceMs,
      onUncooperativeTask: async (error) => {
        this.#poisoned = true;
        await options.onIsolationFailure?.(this.#binding, error);
      }
    });
  }
  get idle() {
    return this.#started && !this.#stopped && !this.poisoned && this.#activeRun === null && this.#ownedTask === null && this.#inFlight.size === 0;
  }
  get poisoned() {
    return this.#poisoned || this.#queue.poisoned;
  }
  async start(binding) {
    if (this.#stopped)
      throw new Error("cannot restart stopped worker instance");
    if (binding.bindingId !== this.bindingId || !sameBinding(binding, this.#binding)) {
      throw new Error("worker start binding mismatch");
    }
    this.#binding = binding;
    this.#started = true;
  }
  async executeTask(run, label, operation, options = {}) {
    this.#assertRun(run);
    if (this.poisoned)
      throw new Error("worker isolation boundary is poisoned");
    if (this.#ownedTask || this.#inFlight.size > 0)
      throw new Error("worker already owns an active task");
    if (this.#activeRun && !sameRun(this.#activeRun, run))
      throw new Error("worker already owns an active run");
    const target = this.#normalizeAbortTarget(options.abortTarget === undefined ? { sessionId: run.sessionId, directory: run.normalizedDirectory } : options.abortTarget);
    const token = {};
    this.#activeRun = run;
    this.#activeAbortTarget = target;
    this.#targetClosing = false;
    this.#ownedTask = token;
    const assertActive = () => {
      if (this.poisoned)
        throw new Error("worker isolation boundary is poisoned");
      if (this.#stopped || this.#ownedTask !== token || !this.#activeRun || !sameRun(this.#activeRun, run)) {
        throw new Error("owned task is inactive");
      }
    };
    try {
      return await this.#enqueue(label, async (signal) => {
        assertActive();
        signal.throwIfAborted();
        const checkpoint = async () => {
          assertActive();
          signal.throwIfAborted();
          await options.activity?.checkpoint(signal);
          assertActive();
          signal.throwIfAborted();
        };
        if (options.activity)
          do {
            await checkpoint();
          } while (options.activity.paused);
        let temporaryActive = false;
        const result = await operation({
          signal,
          checkpoint,
          poll: (read, pollOptions) => {
            assertActive();
            return pollRunResult(run, read, {
              ...pollOptions,
              signal,
              ...options.activity ? { activity: options.activity, checkpoint: (pollSignal) => options.activity.checkpoint(pollSignal) } : {},
              isCurrent: () => {
                try {
                  assertActive();
                  return true;
                } catch {
                  return false;
                }
              }
            });
          },
          setAbortTarget: (next) => {
            assertActive();
            signal.throwIfAborted();
            if (temporaryActive)
              throw new Error("temporary session owns the abort target");
            this.#activeAbortTarget = this.#normalizeAbortTarget(next);
          },
          withTemporarySession: async (sessionOptions, callback) => {
            assertActive();
            signal.throwIfAborted();
            if (options.activity)
              do {
                await checkpoint();
              } while (options.activity.paused);
            if (temporaryActive)
              throw new Error("owned task already has an active temporary session");
            if (!this.options.temporarySessionPort)
              throw new Error("temporary session port is not configured");
            temporaryActive = true;
            const previousTarget = this.#activeAbortTarget;
            try {
              return await new TemporarySessionRunner(this.options.temporarySessionPort, this.options.stopTimeoutMs).run({ sessionId: run.sessionId, directory: run.normalizedDirectory }, sessionOptions, callback, signal, {
                acquire: (session) => {
                  assertActive();
                  this.#activeAbortTarget = this.#normalizeAbortTarget(session);
                  this.#targetClosing = false;
                },
                ...options.activity ? { activity: options.activity } : {},
                beginCleanup: () => {
                  this.#targetClosing = true;
                },
                release: () => {
                  if (this.#ownedTask === token && this.#activeRun && sameRun(this.#activeRun, run)) {
                    this.#activeAbortTarget = this.#normalizeAbortTarget(previousTarget);
                    this.#targetClosing = false;
                  }
                },
                cleanupFailed: (error) => {
                  this.#poisoned = true;
                  const failure = new QueuePoisonedError("temporary session cleanup failed; worker cannot be reused", error);
                  Promise.resolve().then(() => this.options.onIsolationFailure?.(this.#binding, failure)).catch(() => {
                    return;
                  });
                }
              });
            } finally {
              temporaryActive = false;
            }
          }
        });
        if (temporaryActive)
          throw new Error("owned task returned before temporary session completed");
        if (options.activity)
          do {
            await checkpoint();
          } while (options.activity.paused);
        assertActive();
        signal.throwIfAborted();
        return result;
      }, options.timeoutMs, options.activity);
    } catch (error) {
      try {
        if (!this.#stopped && this.#ownedTask === token && this.#activeAbortTarget) {
          const failedTarget = this.#activeAbortTarget;
          await withDeadline((signal) => this.options.abortSession(failedTarget, signal), {
            timeoutMs: this.options.stopTimeoutMs,
            label: "failed task cleanup"
          });
        }
      } catch (cleanupError) {
        this.#poisoned = true;
        const failure = new QueuePoisonedError("remote task cleanup failed; worker cannot be reused", cleanupError);
        Promise.resolve().then(() => this.options.onIsolationFailure?.(this.#binding, failure)).catch(() => {
          return;
        });
        throw new AggregateError([error, cleanupError], "owned task and remote cleanup failed");
      } finally {
        this.complete(run);
      }
      throw error;
    } finally {
      if (this.#ownedTask === token)
        this.#ownedTask = null;
      if (!this.#activeRun && !this.poisoned)
        this.#activeAbortTarget = null;
    }
  }
  complete(run) {
    if (!this.#activeRun || !sameRun(this.#activeRun, run))
      return;
    this.#activeRun = null;
    if (!this.#ownedTask && !this.poisoned)
      this.#activeAbortTarget = null;
  }
  executionTarget(run) {
    if (this.#stopped || this.poisoned || this.#targetClosing || !this.#activeRun || !sameRun(this.#activeRun, run))
      return null;
    return this.#activeAbortTarget;
  }
  executePrompt(run, prompt, options = {}) {
    this.#assertRun(run);
    const client = this.client;
    if (!client)
      throw new Error("OpenCode prompt port is not configured");
    if (this.#ownedTask)
      throw new Error("worker already owns an active task");
    if (this.#activeRun)
      throw new Error("worker already owns an active run");
    if (this.#poisoned)
      return Promise.reject(new Error("worker isolation boundary is poisoned"));
    return this.#enqueue("prompt:" + run.runId, (signal) => {
      signal.throwIfAborted();
      return client.prompt(run.sessionId, prompt, {
        id: run.runId,
        delivery: options.delivery ?? "queue",
        resume: options.resume ?? true,
        signal
      });
    }, this.options.promptTimeoutMs);
  }
  #enqueue(label, operation, timeoutMs, activity) {
    const task = this.#queue.enqueue(label, (taskSignal) => operation(AbortSignal.any([taskSignal, this.#controller.signal])), timeoutMs, activity);
    this.#inFlight.add(task);
    task.then(() => this.#inFlight.delete(task), () => this.#inFlight.delete(task));
    return task;
  }
  async stop(_reason) {
    if (this.#stopped)
      return;
    this.#stopped = true;
    const target = this.#activeAbortTarget;
    this.#activeRun = null;
    this.#activeAbortTarget = null;
    this.#controller.abort(new DOMException("Worker stopped", "AbortError"));
    if (this.#inFlight.size === 0 && !target)
      return;
    try {
      await withDeadline(async (signal) => {
        await Promise.all([
          Promise.allSettled([...this.#inFlight]),
          target ? this.options.abortSession(target, signal) : Promise.resolve()
        ]);
      }, { timeoutMs: this.options.stopTimeoutMs, label: "worker stop" });
    } catch (error) {
      if (error instanceof DeadlineExceededError)
        throw new WorkerStopTimeoutError(this.bindingId, this.options.stopTimeoutMs);
      throw error;
    }
  }
  #normalizeAbortTarget(target) {
    if (target === null)
      return null;
    if (path4.resolve(target.directory) !== path4.resolve(this.#binding.normalizedDirectory)) {
      throw new Error("abort target must remain in the Topic workspace");
    }
    if (!target.sessionId.trim())
      throw new Error("abort target requires a session id");
    if (!this.options.abortSession)
      throw new Error("OpenCode session abort port is not configured");
    return Object.freeze({ sessionId: target.sessionId, directory: path4.resolve(target.directory) });
  }
  #assertRun(run) {
    if (!this.#started || this.#stopped)
      throw new Error("worker is not active");
    if (run.workerGeneration !== this.generation || !sameBinding(run, this.#binding)) {
      throw new Error("run does not belong to this worker lease");
    }
  }
}
function createOpenCodeTopicWorkerFactory(client, options) {
  return (binding, generation) => new OpenCodeTopicWorker(binding, generation, client, options);
}

// runtime/src/railway/resource-governor.ts
import { readFileSync } from "fs";
var CGROUP_MEMORY_CURRENT = "/sys/fs/cgroup/memory.current";
var CGROUP_MEMORY_MAX = "/sys/fs/cgroup/memory.max";
var CGROUP_MEMORY_STAT = "/sys/fs/cgroup/memory.stat";
function readPositiveBytes(filePath) {
  try {
    const value = readFileSync(filePath, "utf8").trim();
    if (!value || value === "max")
      return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

class RailwayResourceGovernor {
  policy;
  now;
  #restartHistory = new Map;
  constructor(policy, now = Date.now) {
    this.policy = policy;
    this.now = now;
    if (policy.softRssBytes <= 0 || policy.hardRssBytes <= policy.softRssBytes) {
      throw new Error("Railway RSS thresholds are invalid");
    }
    if (policy.maxWorkers < 1)
      throw new Error("Railway maxWorkers must be >= 1");
    if (policy.maxRestartsPerBinding < 1) {
      throw new Error("Railway maxRestartsPerBinding must be >= 1");
    }
    if (policy.restartWindowMs <= 0) {
      throw new Error("Railway restartWindowMs must be > 0");
    }
  }
  get trackedRestartBindingCount() {
    return this.#restartHistory.size;
  }
  evaluate(snapshot) {
    const totalBytes = snapshot.totalBytes ?? snapshot.rssBytes;
    if (totalBytes >= this.policy.hardRssBytes)
      return "EMERGENCY_SHUTDOWN";
    if (snapshot.rssBytes >= this.policy.softRssBytes) {
      return snapshot.idleWorkerCount > 0 ? "EVICT_IDLE" : "REJECT_NEW_WORK";
    }
    if (snapshot.workerCount >= this.policy.maxWorkers) {
      return snapshot.idleWorkerCount > 0 ? "EVICT_IDLE" : "REJECT_NEW_WORK";
    }
    return "NORMAL";
  }
  permitRestart(bindingId) {
    const now = this.now();
    const cutoff = now - this.policy.restartWindowMs;
    this.#pruneRestartHistory(cutoff);
    const recent = this.#restartHistory.get(bindingId) ?? [];
    if (recent.length >= this.policy.maxRestartsPerBinding)
      return false;
    this.#restartHistory.set(bindingId, [...recent, now]);
    return true;
  }
  #pruneRestartHistory(cutoff) {
    for (const [bindingId, stamps] of this.#restartHistory) {
      const recent = stamps.filter((stamp) => stamp > cutoff);
      if (recent.length === 0) {
        this.#restartHistory.delete(bindingId);
      } else if (recent.length !== stamps.length) {
        this.#restartHistory.set(bindingId, recent);
      }
    }
  }
  static serviceMemoryBytes() {
    return readPositiveBytes(CGROUP_MEMORY_CURRENT) ?? process.memoryUsage.rss();
  }
  static serviceWorkingSetBytes(totalBytes = RailwayResourceGovernor.serviceMemoryBytes()) {
    try {
      const stat = readFileSync(CGROUP_MEMORY_STAT, "utf8");
      const inactiveFileLine = stat.split(/\r?\n/).find((line) => line.startsWith("inactive_file "));
      if (!inactiveFileLine)
        return totalBytes;
      const inactiveFileBytes = Number.parseInt(inactiveFileLine.slice("inactive_file ".length).trim(), 10);
      if (!Number.isSafeInteger(inactiveFileBytes) || inactiveFileBytes <= 0 || inactiveFileBytes >= totalBytes) {
        return totalBytes;
      }
      return totalBytes - inactiveFileBytes;
    } catch {
      return totalBytes;
    }
  }
  static serviceMemoryLimitBytes() {
    return readPositiveBytes(CGROUP_MEMORY_MAX);
  }
  static currentSnapshot(workerCount, idleWorkerCount) {
    const totalBytes = RailwayResourceGovernor.serviceMemoryBytes();
    return {
      rssBytes: RailwayResourceGovernor.serviceWorkingSetBytes(totalBytes),
      totalBytes,
      workerCount,
      idleWorkerCount
    };
  }
}

// runtime/src/presentation/telegram-rich-renderer.ts
function isInlineArray(value) {
  return Array.isArray(value);
}
function compileInline(value) {
  if (typeof value === "string")
    return value;
  if (isInlineArray(value))
    return value.map(compileInline);
  switch (value.type) {
    case "math":
      return { type: "mathematical_expression", expression: value.expression };
    case "url":
      return { type: "url", text: compileInline(value.text), url: value.url };
    case "email":
      return { type: "email_address", text: compileInline(value.text), email_address: value.email };
    case "phone":
      return { type: "phone_number", text: compileInline(value.text), phone_number: value.phone };
    case "mention":
      return { type: "mention", text: compileInline(value.text), username: value.username };
    case "text_mention":
      return { type: "text_mention", text: compileInline(value.text), user: value.user };
    case "custom_emoji":
      return {
        type: "custom_emoji",
        custom_emoji_id: value.customEmojiId,
        alternative_text: value.alternativeText
      };
    default:
      return { type: value.type, text: compileInline(value.text) };
  }
}
function compileMediaRef(ref) {
  if (ref.kind === "file_id")
    return ref.fileId;
  if (!ref.url.startsWith("https://")) {
    throw new Error("rich media reference must be a file_id or an https:// URL");
  }
  return ref.url;
}
function compileCaption(caption) {
  if (!caption)
    return;
  return {
    text: compileInline(caption.text),
    ...caption.credit !== undefined ? { credit: compileInline(caption.credit) } : {}
  };
}
function compileListItem(item, allowThinking) {
  return {
    blocks: item.blocks.map((block) => compileBlock(block, allowThinking)).filter(isBlock),
    ...item.marker !== undefined ? { type: item.marker } : {},
    ...item.hasCheckbox ? { has_checkbox: true } : {},
    ...item.isChecked ? { is_checked: true } : {},
    ...item.value !== undefined ? { value: item.value } : {}
  };
}
function compileCell(cell) {
  return {
    align: cell.align ?? "left",
    valign: cell.valign ?? "top",
    ...cell.text !== undefined ? { text: compileInline(cell.text) } : {},
    ...cell.isHeader ? { is_header: true } : {},
    ...cell.colspan !== undefined ? { colspan: cell.colspan } : {},
    ...cell.rowspan !== undefined ? { rowspan: cell.rowspan } : {}
  };
}
function isBlock(value) {
  return value !== null;
}
function compileBlock(block, allowThinking) {
  switch (block.type) {
    case "paragraph":
      return { type: "paragraph", text: compileInline(block.text) };
    case "heading":
      return { type: "heading", text: compileInline(block.text), size: block.level };
    case "code": {
      const result = { type: "pre", text: compileInline(block.text) };
      if (block.language)
        result.language = block.language;
      return result;
    }
    case "quote": {
      const credit = block.credit === undefined ? {} : { credit: compileInline(block.credit) };
      return block.expandable ? { type: "expandable_blockquote", text: compileInline(block.text), ...credit } : {
        type: "blockquote",
        blocks: [{ type: "paragraph", text: compileInline(block.text) }],
        ...credit
      };
    }
    case "pullquote":
      return {
        type: "pullquote",
        text: compileInline(block.text),
        ...block.credit !== undefined ? { credit: compileInline(block.credit) } : {}
      };
    case "math":
      return { type: "mathematical_expression", expression: block.expression };
    case "divider":
      return { type: "divider" };
    case "thinking":
      return allowThinking ? { type: "thinking", text: compileInline(block.text) } : null;
    case "footer":
      return { type: "footer", text: compileInline(block.text) };
    case "anchor":
      return { type: "anchor", name: block.name };
    case "list":
      return {
        type: "list",
        items: block.items.map((item) => compileListItem(item, allowThinking))
      };
    case "table":
      return {
        type: "table",
        cells: block.cells.map((row) => row.map(compileCell)),
        ...block.isBordered ? { is_bordered: true } : {},
        ...block.isStriped ? { is_striped: true } : {},
        ...block.isCompact ? { is_compact: true } : {},
        ...block.caption ? { caption: compileInline(block.caption.text) } : {}
      };
    case "details":
      return {
        type: "details",
        summary: compileInline(block.summary),
        blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock),
        ...block.isOpen ? { is_open: true } : {}
      };
    case "collage":
    case "slideshow":
      return {
        type: block.type,
        blocks: block.blocks.map((inner) => compileBlock(inner, allowThinking)).filter(isBlock),
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "photo":
      return {
        type: "photo",
        photo: { type: "photo", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "video":
      return {
        type: "video",
        video: { type: "video", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "audio":
      return {
        type: "audio",
        audio: { type: "audio", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "animation":
      return {
        type: "animation",
        animation: { type: "animation", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "document":
      return {
        type: "document",
        document: { type: "document", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "voice":
    case "voice_note":
      return {
        type: "voice_note",
        voice_note: { type: "voice_note", media: compileMediaRef(block.media) },
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
    case "map":
      return {
        type: "map",
        location: { latitude: block.latitude, longitude: block.longitude },
        ...block.zoom !== undefined ? { zoom: block.zoom } : {},
        ...block.width !== undefined ? { width: block.width } : {},
        ...block.height !== undefined ? { height: block.height } : {},
        ...block.caption ? { caption: compileCaption(block.caption) } : {}
      };
  }
}
function renderTelegramRichDocument(document2, options) {
  const blocks = document2.blocks.map((block) => compileBlock(block, options.draft)).filter(isBlock);
  const result = { blocks };
  if (document2.rtl !== undefined)
    result.is_rtl = document2.rtl;
  return result;
}
function renderTelegramRichMarkdown(markdown, options = {}) {
  const result = { markdown };
  if (options.rtl !== undefined)
    result.is_rtl = options.rtl;
  if (options.skipEntityDetection !== undefined) {
    result.skip_entity_detection = options.skipEntityDetection;
  }
  return result;
}

// runtime/src/telegram/rich-stream.ts
class RichStreamFencedError extends Error {
  constructor() {
    super("rich stream fencing rejected outbound Telegram mutation");
    this.name = "RichStreamFencedError";
  }
}
function routeKey(route, draftId) {
  return route.chatId + ":" + (route.messageThreadId ?? 0) + ":" + draftId;
}
function baseDraftId(runId) {
  let hash = 2166136261;
  for (let i = 0;i < runId.length; i += 1) {
    hash ^= runId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 1 || 1;
}

class TelegramRichStreamController {
  bindings;
  runs;
  port;
  abortRun;
  finishRun;
  #leases = new Map;
  constructor(bindings, runs, port, abortRun, finishRun = (run) => {
    this.runs.finish(run);
  }) {
    this.bindings = bindings;
    this.runs = runs;
    this.port = port;
    this.abortRun = abortRun;
    this.finishRun = finishRun;
  }
  async start(run, route, document2, signal) {
    if (!this.#accepts(run))
      return null;
    const draftId = this.#allocateDraftId(run, route);
    const key = routeKey(route, draftId);
    const lease = { run, route, draftId };
    this.#leases.set(key, lease);
    try {
      if (!await this.#deliver(key, lease, signal, () => this.port.sendDraft(route, draftId, renderTelegramRichDocument(document2, { draft: true }), signal)))
        return null;
    } catch (error) {
      this.#dropLease(key, lease, "Draft send failed");
      throw error;
    }
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft fenced after send");
      return null;
    }
    return draftId;
  }
  async startMarkdown(run, route, markdown, signal) {
    if (!this.#accepts(run))
      return null;
    const draftId = this.#allocateDraftId(run, route);
    const key = routeKey(route, draftId);
    const lease = { run, route, draftId };
    this.#leases.set(key, lease);
    try {
      if (!await this.#deliver(key, lease, signal, () => this.port.sendDraft(route, draftId, renderTelegramRichMarkdown(markdown), signal)))
        return null;
    } catch (error) {
      this.#dropLease(key, lease, "Draft send failed");
      throw error;
    }
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft fenced after send");
      return null;
    }
    return draftId;
  }
  async streamMarkdown(run, route, chunks, streamPort, signal) {
    if (!this.#accepts(run))
      return false;
    const draftId = this.#allocateDraftId(run, route);
    const controller = new AbortController;
    const combinedSignal = signal === undefined ? controller.signal : AbortSignal.any([signal, controller.signal]);
    const key = routeKey(route, draftId);
    const lease = { run, route, draftId, controller };
    this.#leases.set(key, lease);
    try {
      await streamPort.streamMarkdown(route, draftId, chunks, {
        signal: combinedSignal,
        withMutation: async (operation) => {
          const delivered = await this.#deliver(key, lease, combinedSignal, operation);
          if (!delivered)
            throw new RichStreamFencedError;
          return delivered.value;
        },
        guard: () => {
          const current = this.#leases.get(key);
          return current === lease && this.#accepts(run);
        }
      });
    } catch (error) {
      this.#dropLease(key, lease, "Draft stream failed");
      if (error instanceof RichStreamFencedError)
        return false;
      throw error;
    }
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Draft stream fenced");
      return false;
    }
    return true;
  }
  releaseDraft(run, route, draftId) {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run))
      return false;
    this.#dropLease(key, lease, "Draft released");
    return true;
  }
  releaseRun(run) {
    let released = 0;
    for (const [key, lease] of this.#leases) {
      if (!sameRun(lease.run, run))
        continue;
      if (this.#dropLease(key, lease, "Run finished"))
        released += 1;
    }
    return released;
  }
  releaseBinding(bindingId) {
    let released = 0;
    for (const [key, lease] of this.#leases) {
      if (lease.run.bindingId !== bindingId)
        continue;
      if (this.#dropLease(key, lease, "Binding fenced"))
        released += 1;
    }
    return released;
  }
  async updateMarkdown(run, route, draftId, markdown, signal) {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run))
      return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft update");
      return false;
    }
    return await this.#deliver(key, lease, signal, () => this.port.sendDraft(route, draftId, renderTelegramRichMarkdown(markdown), signal)) !== null;
  }
  async finalizeMarkdown(run, route, draftId, markdown, signal) {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run))
      return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft finalize");
      return false;
    }
    if (!await this.#deliver(key, lease, signal, () => this.port.sendFinal(route, renderTelegramRichMarkdown(markdown), signal)))
      return false;
    this.#dropLease(key, lease, "Draft finalized");
    return true;
  }
  async update(run, route, draftId, document2, signal) {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run))
      return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft update");
      return false;
    }
    return await this.#deliver(key, lease, signal, () => this.port.sendDraft(route, draftId, renderTelegramRichDocument(document2, { draft: true }), signal)) !== null;
  }
  async finalize(run, route, draftId, document2, signal) {
    const key = routeKey(route, draftId);
    const lease = this.#leases.get(key);
    if (!lease || !sameRun(lease.run, run))
      return false;
    if (!this.#accepts(run)) {
      this.#dropLease(key, lease, "Stale draft finalize");
      return false;
    }
    if (!await this.#deliver(key, lease, signal, () => this.port.sendFinal(route, renderTelegramRichDocument(document2, { draft: false }), signal)))
      return false;
    this.#dropLease(key, lease, "Draft finalized");
    return true;
  }
  async stopped(event) {
    const route = event.message_thread_id === undefined ? { chatId: event.chat.id } : { chatId: event.chat.id, messageThreadId: event.message_thread_id };
    const key = routeKey(route, event.draft_id);
    const lease = this.#leases.get(key);
    if (!lease)
      return false;
    if (!this.#accepts(lease.run)) {
      this.#dropLease(key, lease, "Stale stop event");
      return false;
    }
    this.#dropLease(key, lease, "Telegram generation stopped");
    this.finishRun(lease.run);
    await this.abortRun(lease.run, "telegram_stop");
    return true;
  }
  async#deliver(key, lease, signal, operation) {
    while (true) {
      try {
        const activity = this.runs.activity(lease.run);
        await activity.checkpoint(signal);
        if (activity.paused)
          continue;
      } catch (error) {
        this.#dropLease(key, lease, "Draft checkpoint failed");
        if (signal?.aborted)
          throw error;
        return null;
      }
      if (!this.#currentLease(key, lease))
        return null;
      return { value: await operation() };
    }
  }
  #currentLease(key, lease) {
    if (this.#leases.get(key) === lease && this.#accepts(lease.run))
      return true;
    this.#dropLease(key, lease, "Draft fenced before send");
    return false;
  }
  #dropLease(key, lease, reason) {
    if (this.#leases.get(key) !== lease)
      return false;
    this.#leases.delete(key);
    lease.controller?.abort(new DOMException(reason, "AbortError"));
    return true;
  }
  #accepts(run) {
    return this.bindings.getExact(run) !== null && this.runs.accepts(run);
  }
  #allocateDraftId(run, route) {
    let candidate = baseDraftId(run.runId);
    while (this.#leases.has(routeKey(route, candidate))) {
      candidate = candidate === 2147483647 ? 1 : candidate + 1;
    }
    return candidate;
  }
}

// runtime/src/telegram/routes.ts
function telegramRouteKey(route) {
  switch (route.kind) {
    case "chat":
      return route.botId + ":chat:" + route.chatId;
    case "topic":
      return route.botId + ":topic:" + route.chatId + ":" + route.threadId;
    case "direct_messages_topic":
      return route.botId + ":direct:" + route.chatId + ":" + route.directMessagesTopicId;
    case "business":
      return route.botId + ":business:" + route.businessConnectionId + ":" + route.chatId + ":" + (route.threadId ?? 0);
    case "inline":
      return route.botId + ":inline:" + route.userId + ":" + route.inlineQueryId;
    case "guest":
      return route.botId + ":guest:" + route.guestQueryId + ":" + (route.chatId ?? 0);
  }
}
async function requireModelAdmission(policy, context) {
  return await policy(context) === "MODEL_ALLOWED";
}

// runtime/src/core.ts
class TelegramNativeCore {
  options;
  bindings;
  runs = new RunRegistry;
  workers;
  outbound;
  events;
  rich;
  liveness;
  stuck;
  resources;
  #execution;
  constructor(options) {
    this.options = options;
    this.bindings = new AtomicBindingStore(options.bindingStorePath);
    this.events = new SessionEventRouter(this.bindings.registry, this.runs, options.resolveSessionParent);
    this.workers = new WorkerSupervisor(options.workerFactory, {
      maxWorkers: options.railwayPolicy.maxWorkers
    });
    this.outbound = new OutboundGateway(this.bindings.registry, this.runs, options.outboundSink);
    this.rich = new TelegramRichStreamController(this.bindings.registry, this.runs, options.richMessagePort, options.abortRun, (run) => {
      this.finishRun(run);
    });
    this.liveness = new RunLivenessTracker(this.runs);
    this.stuck = new PerRunStuckDetector(this.runs, options.stuckRepeatThreshold ?? 5);
    this.resources = new RailwayResourceGovernor(options.railwayPolicy);
    if (options.executionControl) {
      this.#execution = new OpenCodeExecutionClient(this.runs, (run) => {
        const worker = this.workers.current(run);
        const target = worker instanceof OpenCodeTopicWorker ? worker.executionTarget(run) : null;
        if (!target || !this.bindings.registry.getExact(run) || !this.runs.accepts(run)) {
          throw new Error("Core run has no current owned execution target");
        }
        return {
          target: Object.freeze({ ...target, runId: run.runId }),
          isCurrent: () => this.bindings.registry.getExact(run) !== null && this.workers.current(run) === worker && worker instanceof OpenCodeTopicWorker && worker.executionTarget(run) === target
        };
      }, options.executionControl.port, options.executionControl.requestTimeoutMs);
    }
  }
  static async open(options) {
    const core = new TelegramNativeCore(options);
    await core.bindings.load();
    await core.reconcilePendingDeletes();
    return core;
  }
  async registerBinding(binding) {
    await this.bindings.register(binding);
  }
  async beginRun(bindingId, runId) {
    const binding = this.bindings.registry.getById(bindingId);
    if (!binding)
      throw new Error("cannot start run for unbound binding " + bindingId);
    let action = this.resourceAction();
    if (action === "EVICT_IDLE") {
      await this.workers.evictOldestIdle("railway_memory_pressure");
      action = this.resourceAction();
    }
    if (action === "EMERGENCY_SHUTDOWN" || action === "REJECT_NEW_WORK" || action === "EVICT_IDLE") {
      throw new Error("Railway resource budget rejects new work: " + action);
    }
    const worker = await this.workers.ensure(binding);
    if (!this.bindings.registry.getExact(binding) || !this.workers.isCurrent(binding, worker)) {
      await this.workers.stopIfCurrent(binding, worker, "stale_binding_admission");
      throw new Error("binding or worker changed during admission: " + bindingId);
    }
    const run = this.runs.startExclusive(binding, worker.generation, runId);
    this.liveness.start(run);
    return run;
  }
  finishRun(run) {
    this.rich.releaseRun(run);
    this.liveness.clear(run);
    this.stuck.clear(run);
    const finished = this.runs.finish(run);
    if (finished)
      this.workers.complete(run);
    return finished;
  }
  async dispatchTask(run, label, operation, options = {}) {
    if (!this.runs.accepts(run))
      throw new Error("Core run was fenced before task dispatch");
    const binding = this.bindings.registry.getExact(run);
    if (!binding)
      throw new Error("Core binding changed before task dispatch");
    const worker = await this.workers.ensure(binding);
    if (!this.runs.accepts(run) || !this.bindings.registry.getExact(run)) {
      throw new Error("Core run was fenced during worker acquisition");
    }
    if (!(worker instanceof OpenCodeTopicWorker) || worker.generation !== run.workerGeneration || !this.workers.isCurrent(binding, worker)) {
      throw new Error("Core worker changed before task dispatch");
    }
    return worker.executeTask(run, label, operation, { ...options, activity: this.runs.activity(run) });
  }
  async pauseRun(run, signal) {
    if (!this.#execution)
      throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "pause", signal);
  }
  async resumeRun(run, signal) {
    if (!this.#execution)
      throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "resume", signal);
  }
  async inspectExecution(run, signal) {
    if (!this.#execution)
      throw new Error("runtime execution control port is not configured");
    return this.#execution.request(run, "execution", signal);
  }
  async rotateBinding(bindingId, next) {
    const current = this.bindings.registry.getById(bindingId);
    if (!current)
      throw new Error("unknown binding " + bindingId);
    const replacement = {
      ...current,
      sessionId: next.sessionId,
      normalizedDirectory: next.normalizedDirectory,
      bindingGeneration: current.bindingGeneration + 1
    };
    await this.bindings.replace(replacement, current.bindingGeneration);
    this.rich.releaseBinding(bindingId);
    this.runs.fence(bindingId);
    await this.workers.stop(bindingId, "binding_rotated");
    return replacement;
  }
  async revokeBinding(bindingId) {
    if (!this.bindings.registry.getById(bindingId))
      return;
    const tombstone = await this.bindings.beginDelete(bindingId);
    this.rich.releaseBinding(bindingId);
    this.runs.fence(bindingId);
    await this.workers.stop(bindingId, "binding_revoked");
    await this.options.cleanupBinding?.(tombstone);
    await this.bindings.completeDelete(bindingId);
  }
  async reconcilePendingDeletes() {
    for (const tombstone of this.bindings.pendingDeletes()) {
      await this.options.cleanupBinding?.(tombstone);
      await this.bindings.completeDelete(tombstone.bindingId);
    }
  }
  workerOutboundGate(bindingId, workerGeneration) {
    return new WorkerOutboundGate({ bindingId, workerGeneration }, this.outbound);
  }
  async modelAllowed(route, operation) {
    return requireModelAdmission(this.options.admissionPolicy, { route, operation });
  }
  async streamMarkdown(run, route, chunks, signal) {
    return this.rich.streamMarkdown(run, route, chunks, this.options.nativeMarkdownStreamPort, signal);
  }
  async handleGenerationStopped(event) {
    return this.rich.stopped(event);
  }
  resourceAction() {
    return this.resources.evaluate(RailwayResourceGovernor.currentSnapshot(this.workers.size(), this.workers.idleCount()));
  }
  async shutdown() {
    for (const binding of this.bindings.registry.list()) {
      this.rich.releaseBinding(binding.bindingId);
      this.runs.fence(binding.bindingId);
    }
    await this.workers.stopAll("gateway_shutdown");
  }
}
// runtime/src/runtime/terminal-state.ts
function completed(text, now = Date.now()) {
  return Object.freeze({
    reason: text.length === 0 ? "COMPLETED_EMPTY" : "COMPLETED",
    finishedAt: now
  });
}
// runtime/src/runtime/workspace-guard.ts
import path5 from "path";
import { realpath } from "fs/promises";

class WorkspaceEscapeError extends Error {
  requestedPath;
  workspaceRoot;
  constructor(requestedPath, workspaceRoot) {
    super(`path escapes workspace: ${requestedPath}`);
    this.requestedPath = requestedPath;
    this.workspaceRoot = workspaceRoot;
    this.name = "WorkspaceEscapeError";
  }
}
function inside(root, target) {
  const relative = path5.relative(root, target);
  return relative === "" || !relative.startsWith("..") && !path5.isAbsolute(relative);
}
async function assertWorkspacePath(workspaceRoot, requestedPath) {
  const root = await realpath(workspaceRoot);
  const candidate = await realpath(path5.resolve(root, requestedPath));
  if (!inside(root, candidate))
    throw new WorkspaceEscapeError(requestedPath, root);
  return candidate;
}
// runtime/src/ipc/json-line-worker-channel.ts
async function consumeWorkerJsonLines(stream, gate) {
  const reader = stream.getReader();
  const decoder = new TextDecoder;
  let buffer = "";
  let accepted = 0;
  let rejected = 0;
  let protocolErrors = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done)
        break;
      buffer += decoder.decode(result.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf(`
`)) >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (line.length === 0)
          continue;
        const outcome = await consumeLine(line, gate);
        accepted += outcome === "accepted" ? 1 : 0;
        rejected += outcome === "rejected" ? 1 : 0;
        protocolErrors += outcome === "protocol_error" ? 1 : 0;
      }
    }
    const tail = buffer.trim();
    if (tail.length > 0) {
      const outcome = await consumeLine(tail, gate);
      accepted += outcome === "accepted" ? 1 : 0;
      rejected += outcome === "rejected" ? 1 : 0;
      protocolErrors += outcome === "protocol_error" ? 1 : 0;
    }
  } finally {
    reader.releaseLock();
  }
  return { accepted, rejected, protocolErrors };
}
async function consumeLine(line, gate) {
  try {
    const value = JSON.parse(line);
    return await gate.accept(value) ? "accepted" : "rejected";
  } catch (error) {
    if (error instanceof WorkerProtocolError || error instanceof SyntaxError) {
      return "protocol_error";
    }
    throw error;
  }
}
// runtime/src/opencode/run-reconciler.ts
class AuthoritativeRunReconciler {
  runs;
  port;
  options;
  constructor(runs, port, options) {
    this.runs = runs;
    this.port = port;
    this.options = options;
  }
  #finish(run) {
    if (this.options.finishRun) {
      this.options.finishRun(run);
      return;
    }
    this.runs.finish(run);
  }
  async probe(run, runStartedAt, signal) {
    if (!this.runs.accepts(run))
      return "stale";
    const activity = this.runs.activity(run);
    if (activity.paused)
      return "active";
    const status = await withDeadline((deadlineSignal) => this.port.status(run, deadlineSignal), {
      timeoutMs: this.options.requestTimeoutMs,
      label: "OpenCode run status probe",
      ...signal ? { parentSignal: signal } : {}
    });
    if (!this.runs.accepts(run))
      return "stale";
    if (activity.paused)
      return "active";
    if (status === "idle" || status === "error") {
      this.#finish(run);
      return "terminal";
    }
    const now = this.options.now ?? Date.now;
    if (status === "retry" && activity.activeTime(now()) - runStartedAt >= this.options.providerRetryCeilingMs) {
      const interrupted = await withDeadline(async (deadlineSignal) => {
        if (!this.runs.accepts(run) || activity.paused)
          return false;
        await this.port.interrupt(run, deadlineSignal);
        return true;
      }, {
        timeoutMs: this.options.requestTimeoutMs,
        label: "OpenCode retry ceiling interrupt",
        ...signal ? { parentSignal: signal } : {}
      });
      if (!this.runs.accepts(run))
        return "stale";
      if (!interrupted)
        return "active";
      this.#finish(run);
      return "aborted_retry_ceiling";
    }
    return "active";
  }
}
// runtime/src/opencode/session-client.ts
class SessionEventIntegrityError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionEventIntegrityError";
  }
}

class SessionEventStreamLostError extends Error {
  reconnects;
  rootCause;
  constructor(reconnects, rootCause) {
    super("OpenCode session event stream exceeded reconnect budget");
    this.reconnects = reconnects;
    this.rootCause = rootCause;
    this.name = "SessionEventStreamLostError";
  }
}

class OpenCodeSessionClient {
  options;
  #baseUrl;
  #fetch;
  constructor(options) {
    this.options = options;
    this.#baseUrl = options.baseUrl.replace(/\/$/, "");
    this.#fetch = options.fetchImpl ?? fetch;
  }
  async history(sessionId, after = 0, signal) {
    const result = await this.#requestJson("GET", "/api/session/" + encodeURIComponent(sessionId) + "/history?after=" + after, undefined, signal);
    return result.data;
  }
  async prompt(sessionId, prompt, options = {}) {
    const body = {
      prompt,
      resume: options.resume ?? true
    };
    if (options.id !== undefined)
      body.id = options.id;
    if (options.delivery !== undefined)
      body.delivery = options.delivery;
    const result = await this.#requestJson("POST", "/api/session/" + encodeURIComponent(sessionId) + "/prompt", body, options.signal);
    if (result.data.sessionID !== sessionId) {
      throw new SessionEventIntegrityError("prompt admission returned foreign session");
    }
    return result.data;
  }
  async interrupt(sessionId, signal) {
    await this.#requestJson("POST", "/api/session/" + encodeURIComponent(sessionId) + "/interrupt", undefined, signal);
  }
  async* events(sessionId, after = 0, signal) {
    let cursor = after;
    let reconnects = 0;
    while (!signal?.aborted) {
      try {
        const response = await this.#connectEvents(sessionId, cursor, signal);
        for await (const event of readSseEvents(response, this.options.eventIdleTimeoutMs, signal)) {
          validateEvent(event, sessionId, cursor);
          if (event.durable.seq <= cursor)
            continue;
          cursor = event.durable.seq;
          yield event;
        }
        if (signal?.aborted)
          return;
        throw new Error("OpenCode SSE stream closed");
      } catch (error) {
        if (signal?.aborted)
          return;
        if (error instanceof SessionEventIntegrityError)
          throw error;
        reconnects += 1;
        if (reconnects > this.options.maxReconnects) {
          throw new SessionEventStreamLostError(reconnects - 1, error);
        }
        await abortableSleep(this.options.reconnectDelayMs * reconnects, signal);
      }
    }
  }
  async#connectEvents(sessionId, after, signal) {
    return withDeadline(async (deadlineSignal) => {
      const response = await this.#fetch(this.#url("/api/session/" + encodeURIComponent(sessionId) + "/event?after=" + after), {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal: deadlineSignal
      });
      if (!response.ok) {
        throw new Error("OpenCode event stream returned HTTP " + response.status);
      }
      if (!response.body) {
        throw new Error("OpenCode event stream has no body");
      }
      return response;
    }, {
      timeoutMs: this.options.requestTimeoutMs,
      label: "OpenCode event subscribe",
      ...signal ? { parentSignal: signal } : {}
    });
  }
  async#requestJson(method, path6, body, signal) {
    return withDeadline(async (deadlineSignal) => {
      const init = { method, signal: deadlineSignal };
      if (body !== undefined) {
        init.headers = { "content-type": "application/json" };
        init.body = JSON.stringify(body);
      }
      const response = await this.#fetch(this.#url(path6), init);
      if (!response.ok) {
        const text2 = await response.text();
        throw new Error("OpenCode " + method + " " + path6 + " -> " + response.status + ": " + text2);
      }
      const text = await response.text();
      return text.length === 0 ? undefined : JSON.parse(text);
    }, {
      timeoutMs: this.options.requestTimeoutMs,
      label: "OpenCode " + method + " " + path6,
      ...signal ? { parentSignal: signal } : {}
    });
  }
  #url(path6) {
    return this.#baseUrl + path6;
  }
}
async function* readSseEvents(response, idleTimeoutMs, signal) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder;
  let buffer = "";
  let dataLines = [];
  try {
    while (!signal?.aborted) {
      const read = reader.read();
      const idleController = new AbortController;
      const idleSignal = signal === undefined ? idleController.signal : AbortSignal.any([signal, idleController.signal]);
      const timeout = abortableSleep(idleTimeoutMs, idleSignal).then(() => {
        throw new Error("OpenCode SSE idle timeout");
      });
      let result;
      try {
        result = await Promise.race([read, timeout]);
      } catch (error) {
        await reader.cancel(error).catch(() => {
          return;
        });
        throw error;
      } finally {
        idleController.abort();
      }
      if (result.done)
        break;
      buffer += decoder.decode(result.value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf(`
`)) >= 0) {
        const rawLine = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        if (line.length === 0) {
          if (dataLines.length > 0) {
            yield JSON.parse(dataLines.join(`
`));
            dataLines = [];
          }
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
  } finally {
    await reader.cancel().catch(() => {
      return;
    });
  }
}
function validateEvent(event, sessionId, cursor) {
  const durable = event?.durable;
  if (!durable || durable.aggregateID !== sessionId || !Number.isSafeInteger(durable.seq)) {
    throw new SessionEventIntegrityError("event durable identity does not match session " + sessionId);
  }
  if (durable.seq < 0 || durable.seq < cursor) {
    throw new SessionEventIntegrityError("event sequence moved backwards");
  }
}
// runtime/src/opencode/session-event-pump.ts
class SessionEventPump {
  client;
  runs;
  constructor(client, runs) {
    this.client = client;
    this.runs = runs;
  }
  async pump(run, after, onEvent, signal) {
    for await (const event of this.client.events(run.sessionId, after, signal)) {
      if (!this.runs.accepts(run))
        return "superseded";
      await onEvent(event);
      if (!this.runs.accepts(run))
        return "superseded";
    }
    return this.runs.accepts(run) ? "completed" : "superseded";
  }
}
// runtime/src/scheduler/task-dispatcher.ts
class ScheduledTaskDispatcher {
  bindings;
  runs;
  supervisor;
  ledger;
  port;
  constructor(bindings, runs, supervisor, ledger, port) {
    this.bindings = bindings;
    this.runs = runs;
    this.supervisor = supervisor;
    this.ledger = ledger;
    this.port = port;
  }
  async dispatch(task) {
    const current = this.bindings.getById(task.bindingId);
    if (!current)
      return "unbound";
    if (!matchesTaskBinding(current, task))
      return "stale_binding";
    if (this.runs.current(current.bindingId))
      return "busy";
    if (!await this.ledger.claim(task.executionId))
      return "duplicate";
    let run = null;
    try {
      const worker = await this.supervisor.ensure(current);
      if (!this.bindings.getExact(current) || !this.supervisor.isCurrent(current, worker)) {
        await this.supervisor.stopIfCurrent(current, worker, "stale_scheduled_admission");
        await this.ledger.release(task.executionId);
        return "stale_binding";
      }
      if (this.runs.current(current.bindingId)) {
        await this.ledger.release(task.executionId);
        return "busy";
      }
      run = this.runs.startExclusive(current, worker.generation, "scheduled:" + task.executionId);
      await this.port.execute(task, run);
      this.runs.finish(run);
      run = null;
      await this.ledger.complete(task.executionId);
      return "executed";
    } catch (error) {
      if (run)
        this.runs.finish(run);
      await this.ledger.release(task.executionId);
      throw error;
    }
  }
}
function matchesTaskBinding(binding, task) {
  return binding.bindingId === task.bindingId && binding.botId === task.botId && binding.chatId === task.chatId && binding.threadId === task.threadId && binding.sessionId === task.sessionId && binding.normalizedDirectory === task.normalizedDirectory && binding.bindingGeneration === task.bindingGeneration;
}

class InMemoryExecutionLedger {
  #claimed = new Set;
  #completed = new Set;
  async claim(executionId) {
    if (this.#claimed.has(executionId) || this.#completed.has(executionId))
      return false;
    this.#claimed.add(executionId);
    return true;
  }
  async complete(executionId) {
    this.#claimed.delete(executionId);
    this.#completed.add(executionId);
  }
  async release(executionId) {
    this.#claimed.delete(executionId);
  }
}
// runtime/src/telegram/api-budget.ts
class TelegramApiBudgetClient {
  transport;
  budget;
  constructor(transport, budget) {
    this.transport = transport;
    this.budget = budget;
  }
  async call(method, payload, options = {}) {
    const startedAt = Date.now();
    let retries = 0;
    while (true) {
      try {
        if (method === "getUpdates") {
          return await this.transport.call(method, payload, options.signal);
        }
        const deadlineOptions = {
          timeoutMs: this.budget.requestTimeoutMs,
          label: `Telegram ${method}`
        };
        if (options.signal)
          deadlineOptions.parentSignal = options.signal;
        return await withDeadline((signal) => this.transport.call(method, payload, signal), deadlineOptions);
      } catch (error) {
        const retryAfterMs = readRetryAfterMs(error);
        if (retryAfterMs === null || retries >= this.budget.maxRetries)
          throw error;
        const delayMs = Math.min(retryAfterMs, this.budget.maxRetryAfterMs);
        if (Date.now() - startedAt + delayMs >= this.budget.maxElapsedMs)
          throw error;
        retries += 1;
        await abortableSleep(delayMs, options.signal);
      }
    }
  }
}
function readRetryAfterMs(error) {
  if (!error || typeof error !== "object")
    return null;
  const retryAfter = Reflect.get(error, "retry_after") ?? Reflect.get(error, "retryAfter");
  return typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0 ? Math.floor(retryAfter * 1000) : null;
}
// runtime/src/telegram/conformance.ts
var TELEGRAM_CONFORMANCE = Object.freeze({
  botApiVersion: "10.3",
  grammyVersion: "1.46.0",
  nativeRichMessages: true,
  nativeRichDraftStreaming: true,
  guestMode: true,
  managedBots: true,
  directMessagesTopics: true,
  businessConnections: true,
  rawApiPassthrough: true
});
// runtime/src/telegram/grammy-markdown-stream-port.ts
var import_stream = __toESM(require_mod(), 1);
class GrammyNativeMarkdownStreamPort {
  api;
  constructor(api) {
    this.api = api;
  }
  async streamMarkdown(route, draftId, chunks, options) {
    const thread = route.messageThreadId === undefined ? {} : { message_thread_id: route.messageThreadId };
    const raw = this.api.raw;
    const guardedRaw = new Proxy(raw, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver);
        if (typeof value !== "function")
          return value;
        if (property === "sendRichMessageDraft" || property === "sendRichMessage") {
          return async (...args) => {
            const mutate = async () => {
              options.signal.throwIfAborted();
              if (!options.guard())
                throw new RichStreamFencedError;
              return Reflect.apply(value, target, args);
            };
            return options.withMutation ? options.withMutation(mutate) : mutate();
          };
        }
        return value.bind(target);
      }
    });
    const stream = import_stream.streamApi(guardedRaw);
    await stream.streamMarkdown(route.chatId, draftId, chunks, {
      ...thread,
      can_stop: true,
      keep_on_stop: true
    }, thread, undefined, options.signal);
  }
}
// runtime/src/telegram/grammy-rich-port.ts
class GrammyRichMessagePort {
  api;
  constructor(api) {
    this.api = api;
  }
  async sendDraft(route, draftId, richMessage, signal) {
    const other = route.messageThreadId === undefined ? { can_stop: true, keep_on_stop: true } : { message_thread_id: route.messageThreadId, can_stop: true, keep_on_stop: true };
    const transportSignal = signal;
    await this.api.sendRichMessageDraft(route.chatId, draftId, richMessage, other, transportSignal);
  }
  async sendFinal(route, richMessage, signal) {
    const other = route.messageThreadId === undefined ? undefined : { message_thread_id: route.messageThreadId };
    const transportSignal = signal;
    await this.api.sendRichMessage(route.chatId, richMessage, other, transportSignal);
  }
}
// runtime/src/telegram/grammy-transport.ts
var import_grammy = __toESM(require_mod2(), 1);

class GrammyTelegramTransport {
  api;
  constructor(token) {
    this.api = new import_grammy.Api(token);
  }
  call(method, payload, signal) {
    const raw = this.api.raw;
    const fn = raw[method];
    if (typeof fn !== "function") {
      throw new Error("Unsupported Telegram Bot API method: " + method);
    }
    return fn.call(this.api.raw, payload, signal);
  }
}
export {
  withDeadline,
  telegramRouteKey,
  sameRun,
  sameBinding,
  requireModelAdmission,
  renderTelegramRichMarkdown,
  renderTelegramRichDocument,
  pollRunResult,
  parseOutboundEnvelope,
  createOpenCodeTopicWorkerFactory,
  consumeWorkerJsonLines,
  completed,
  compileInline,
  bindingKey,
  assertWorkspacePath,
  abortableSleep,
  WorkspaceEscapeError,
  WorkerSupervisor,
  WorkerStopTimeoutError,
  WorkerProtocolError,
  WorkerOutboundGate,
  TemporarySessionRunner,
  TelegramRichStreamController,
  TelegramNativeCore,
  TelegramApiBudgetClient,
  TELEGRAM_CONFORMANCE,
  StalePollRunError,
  SessionEventStreamLostError,
  SessionEventRouter,
  SessionEventPump,
  SessionEventIntegrityError,
  SerialTaskQueue,
  ScheduledTaskDispatcher,
  RunRegistry,
  RunLivenessTracker,
  RichStreamFencedError,
  RailwayResourceGovernor,
  QueuePoisonedError,
  PollAttemptsExceededError,
  PerRunStuckDetector,
  OutboundGateway,
  OpenCodeTopicWorker,
  OpenCodeSessionClient,
  OpenCodeExecutionClient,
  InMemoryExecutionLedger,
  GrammyTelegramTransport,
  GrammyRichMessagePort,
  GrammyNativeMarkdownStreamPort,
  DeadlineExceededError,
  BindingRegistry,
  BindingIntegrityError,
  AuthoritativeRunReconciler,
  AtomicBindingStore
};
