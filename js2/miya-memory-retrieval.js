/**
 * miya-memory-retrieval.js — 记忆检索层（蚀月定制）
 * 双通道：向量优先（OpenAI 兼容 /embeddings，模型名智能识别）→ cosine → topK；
 * 向量不可用/失败 → 本地兜底：CJK bigram + 英文分词，纯同步、零依赖、断网可用。
 * 设计致敬 ai-virtual-phone memory-embedding.ts 与 55582 本地 bigram 方案（代码自写）。
 */
(function (global) {
  'use strict';

  var EMBEDDING_MODEL_RE = /embed|bge-|m3e|text2vec|\be5\b|\bgte\b/i;

  function isEmbeddingModelName(model) {
    return EMBEDDING_MODEL_RE.test(String(model || ''));
  }

  function getApiConfig() {
    if (typeof global.miyaGetApiConfigCached === 'function') return global.miyaGetApiConfigCached();
    return {};
  }

  /** 生成向量：POST {baseUrl}/embeddings；失败返回 null（不抛） */
  function generateEmbedding(text, cfg) {
    cfg = cfg && typeof cfg === 'object' ? cfg : getApiConfig();
    var baseUrl = String(cfg.embeddingBaseUrl || cfg.baseUrl || '').trim().replace(/\/+$/, '');
    var apiKey = String(cfg.embeddingApiKey || cfg.apiKey || '').trim();
    var model = String(cfg.embeddingModel || '').trim();
    // 兼容模式：向量配置留空 → 自动跟随主线路
    if (!model) {
      var mainModel = String(cfg.model || '').trim();
      if (isEmbeddingModelName(mainModel)) {
        model = mainModel;
      } else if (/bigmodel|zhipu/i.test(baseUrl)) {
        model = 'embedding-2';
      }
    }
    if (!isEmbeddingModelName(model)) return Promise.resolve(null);
    if (!baseUrl || !apiKey) return Promise.resolve(null);
    var url = baseUrl.endsWith('/embeddings') ? baseUrl : baseUrl + '/embeddings';
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify({ model: model, input: text })
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json();
    }).then(function (data) {
      var emb = data && data.data && data.data[0] && data.data[0].embedding;
      return Array.isArray(emb) && emb.length > 0 ? emb : null;
    }).catch(function () {
      return null;
    });
  }

  function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
    var dot = 0, magA = 0, magB = 0;
    for (var i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      magA += a[i] * a[i];
      magB += b[i] * b[i];
    }
    var denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
  }

  /** 分词：拉丁词 + CJK bigram */
  function extractTokens(text) {
    var lower = String(text || '').toLowerCase();
    var words = lower.match(/[a-zA-Z0-9]+/g) || [];
    var cjk = lower.match(/[\u2E80-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF]+/g) || [];
    var bigrams = [];
    for (var i = 0; i < cjk.length; i++) {
      var seg = cjk[i];
      for (var j = 0; j < seg.length - 1; j++) {
        bigrams.push(seg.slice(j, j + 2));
      }
      if (seg.length === 1) bigrams.push(seg);
    }
    return words.concat(bigrams);
  }

  /** 关键词检索（同步）：query tokens 命中比例打分，>0 才返回 */
  function keywordSearch(query, memories, topK) {
    if (!Array.isArray(memories) || memories.length === 0) return [];
    var qTokens = extractTokens(query);
    if (qTokens.length === 0) {
      return memories.slice(-topK).reverse().map(function (m) {
        return { entry: m, score: 0.5 };
      });
    }
    var scored = [];
    for (var i = 0; i < memories.length; i++) {
      var m = memories[i];
      var content = String((m && (m.content || m.text)) || '');
      var eTokens = extractTokens(content);
      if (eTokens.length === 0) continue;
      var matched = 0;
      for (var j = 0; j < qTokens.length; j++) {
        var qt = qTokens[j];
        var hit = false;
        for (var k = 0; k < eTokens.length; k++) {
          if (eTokens[k].indexOf(qt) >= 0 || qt.indexOf(eTokens[k]) >= 0) { hit = true; break; }
        }
        if (hit) matched++;
      }
      if (matched > 0) {
        scored.push({ entry: m, score: matched / qTokens.length });
      }
    }
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, topK || 5);
  }

  /** 统一检索入口：向量优先（异步），失败/超时降级关键词（同步结果立即返回） */
  function searchMemories(query, memories, topK, cfg) {
    var kw = keywordSearch(query, memories, topK);
    if (!Array.isArray(memories) || memories.length === 0) return Promise.resolve([]);
    var model = String((cfg && cfg.embeddingModel) || '').trim() ||
      String((cfg && cfg.model) || '').trim();
    if (!isEmbeddingModelName(model)) return Promise.resolve(kw);
    return generateEmbedding(query, cfg).then(function (qEmb) {
      if (!qEmb) return kw;
      var withEmb = memories.filter(function (m) {
        return m && Array.isArray(m.embedding) && m.embedding.length > 0;
      });
      if (withEmb.length === 0) return kw;
      var scored = withEmb.map(function (m) {
        return { entry: m, score: cosineSimilarity(qEmb, m.embedding) };
      });
      scored.sort(function (a, b) { return b.score - a.score; });
      var top = scored.slice(0, topK || 5);
      // 向量结果太差（低于阈值）时退回关键词结果，保证可用性
      if (top.length && top[0].score > 0.25) return top;
      return kw;
    }).catch(function () {
      return kw;
    });
  }

  global.miyaMemoryRetrieval = {
    searchMemories: searchMemories,
    keywordSearch: keywordSearch,
    generateEmbedding: generateEmbedding,
    cosineSimilarity: cosineSimilarity,
    extractTokens: extractTokens,
    isEmbeddingModelName: isEmbeddingModelName
  };
})(typeof window !== 'undefined' ? window : this);
