const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 内存存储（Vercel Serverless 无持久化）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

// 历史记录（内存存储，重启后清空）
let historyStore = [];

// GLM API Key
const GLM_API_KEY = process.env.GLM_API_KEY;

// Prompt模板
const ANALYSIS_PROMPT = `你是一个专业的文章总结专家。请分析以下文章，按照"问题设计五步法"生成结构清晰的总结。

## 问题设计五步法

**⚠️ 避免泛泛的概念性问题，要抓核心、有具体指向：**
- ❌ "什么是X？" → 太学术、太宽泛
- ✅ "X为何从'A'变成了'B'？" → 有具体变化、有对比
- ✅ "作者判断与市场主流预期有何分歧？" → 有对比、有投资价值

**五步法设计问题：**
1. **本质层**：文章描述的核心变化/冲突是什么？（从A到B的范式转移）
2. **机制层**：这个变化背后的关键驱动机制是什么？
3. **变量层**：哪个具体因素是关键变量/转折点？（具体数据/时间点）
4. **预期差**：作者判断与市场共识有何关键分歧？（投资价值所在）
5. **角色层**：谁在推动变化？谁受益？谁受损？/ 或行动建议

## 输出格式

请严格按照以下JSON格式输出：

\`\`\`json
{
  "title": "主标题（核心主题，不超过20字）",
  "subtitle": "副标题（来源/作者信息）",
  "tagLine": "分类标签（如：深度分析 | 2024）",
  "questions": [
    {
      "question": "问题文本",
      "answer": "答案内容，使用**加粗**强调关键概念",
      "type": "logic|data|compare|timeline|action"
    }
  ],
  "keywords": ["关键词1", "关键词2", "关键词3", "关键词4", "关键词5", "关键词6"],
  "source": "来源信息"
}
\`\`\`

## 答案格式规范

1. **logic类型**：包含逻辑链，格式如下
   \`核心观点。逻辑链：A → B → C → D\`

2. **data类型**：包含关键数据，使用数据框展示

3. **compare类型**：包含对比，使用对比框展示

4. **timeline类型**：包含时间线/时间点

5. **action类型**：包含行动建议/优先级列表

---

**以下是待分析的文章原文，请基于此内容生成总结：**

`;

// GLM API调用
async function callGLMApi(content) {
  if (!GLM_API_KEY) {
    throw new Error('API Key 未配置');
  }

  const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GLM_API_KEY}`
    },
    body: JSON.stringify({
      model: 'GLM-4',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: ANALYSIS_PROMPT + content
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GLM API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

// JSON解析
function parseJsonResponse(responseText) {
  let jsonStr = '';
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  } else if (responseText.trim().startsWith('{')) {
    jsonStr = responseText.trim();
  }

  if (!jsonStr) {
    throw new Error('无法从响应中提取 JSON');
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    let fixed = jsonStr.replace(/,(\s*[}\]])/g, '$1');
    fixed = fixed.replace(/[""]/g, '"').replace(/['']/g, "'");
    fixed = fixed.replace(/：/g, ':');
    return JSON.parse(fixed);
  }
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '服务运行正常',
    apiKeyConfigured: !!GLM_API_KEY
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  res.json({ success: true, data: historyStore });
});

// 删除历史记录
app.delete('/api/history/:id', (req, res) => {
  historyStore = historyStore.filter(item => item.id !== req.params.id);
  res.json({ success: true });
});

// 分析文章
app.post('/api/analyze', async (req, res) => {
  const { content, source } = req.body;

  if (!content) {
    return res.status(400).json({ error: '请提供文章内容' });
  }

  try {
    const responseText = await callGLMApi(content);
    const result = parseJsonResponse(responseText);

    const historyItem = {
      id: Date.now().toString(),
      title: result.title,
      source: result.source || source || '文本输入',
      data: result,
      inputType: 'text',
      createdAt: new Date().toISOString()
    };
    historyStore.unshift(historyItem);
    if (historyStore.length > 50) historyStore.pop();

    res.json({ success: true, data: result, historyId: historyItem.id });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || '分析失败',
      details: error.toString()
    });
  }
});

// 上传PDF
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传文件' });
  }

  try {
    const pdfData = await pdf(req.file.buffer);
    const content = pdfData.text;

    if (!content || content.trim().length < 100) {
      return res.json({
        success: false,
        error: 'PDF 内容为空或太少',
        details: '可能是扫描版PDF（图片），无法提取文字。'
      });
    }

    const responseText = await callGLMApi(content);
    const result = parseJsonResponse(responseText);

    const historyItem = {
      id: Date.now().toString(),
      title: result.title,
      source: result.source || req.file.originalname,
      data: result,
      inputType: 'pdf',
      createdAt: new Date().toISOString()
    };
    historyStore.unshift(historyItem);
    if (historyStore.length > 50) historyStore.pop();

    res.json({ success: true, data: result, historyId: historyItem.id });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || '处理失败',
      details: error.toString()
    });
  }
});

// URL抓取
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: '请提供URL' });
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, aside').remove();

    let content = '';
    $('article, .content, .article, main, #content, .post').each((i, el) => {
      content += $(el).text() + '\n';
    });

    if (!content.trim()) {
      content = $('body').text();
    }

    content = content.replace(/\s+/g, ' ').trim();

    const responseText = await callGLMApi(content.substring(0, 50000));
    const result = parseJsonResponse(responseText);

    const historyItem = {
      id: Date.now().toString(),
      title: result.title,
      source: result.source || url,
      data: result,
      inputType: 'url',
      url: url,
      createdAt: new Date().toISOString()
    };
    historyStore.unshift(historyItem);
    if (historyStore.length > 50) historyStore.pop();

    res.json({ success: true, data: result, historyId: historyItem.id });
  } catch (error) {
    res.json({
      success: false,
      error: error.message || '抓取失败',
      details: error.toString()
    });
  }
});

// Vercel Serverless 导出
module.exports = app;
