/**
 * 文章总结生成器 - 后端服务
 * 启动: node server.js
 * 访问: http://localhost:3000
 * API: 智谱 GLM
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const pdf = require('pdf-parse');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const GLM_API_KEY = process.env.GLM_API_KEY;

// 历史记录文件路径
const HISTORY_FILE = path.join(__dirname, 'data', 'history.json');

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('public'));

// 配置文件上传
const upload = multer({
  dest: 'uploads/',
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// 确保必要目录存在
if (!fs.existsSync('uploads')) fs.mkdirSync('uploads');
if (!fs.existsSync('data')) fs.mkdirSync('data');
if (!fs.existsSync(path.join(__dirname, 'data'))) {
  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

// ============ 历史记录管理 ============
function loadHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('加载历史记录失败:', error);
  }
  return [];
}

function saveHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('保存历史记录失败:', error);
  }
}

function addHistory(item) {
  const history = loadHistory();
  // 添加到开头
  history.unshift({
    id: Date.now().toString(),
    ...item,
    createdAt: new Date().toISOString()
  });
  // 最多保留50条
  if (history.length > 50) history.pop();
  saveHistory(history);
  return history[0];
}

// ============ 核心Prompt模板 ============
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

// ============ GLM API 调用函数 ============
async function callGLMApi(content) {
  if (!GLM_API_KEY || GLM_API_KEY === 'your_glm_api_key_here') {
    throw new Error('API Key 未配置，请在 .env 文件中设置 GLM_API_KEY');
  }

  // 构建完整消息
  const fullContent = ANALYSIS_PROMPT + content;

  console.log('发送到 GLM，总长度:', fullContent.length, '字符');
  console.log('文章内容长度:', content.length, '字符');
  console.log('文章内容预览:', content.substring(0, 300) + '...');

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
        content: fullContent
      }]
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GLM API 错误 (${response.status}): ${errorText}`);
  }

  const data = await response.json();

  if (!data.choices || !data.choices[0] || !data.choices[0].message) {
    throw new Error('GLM API 返回格式异常');
  }

  return data.choices[0].message.content;
}

// 解析 JSON 响应（增强容错）
function parseJsonResponse(responseText) {
  console.log('===== GLM 原始响应 =====');
  console.log(responseText.substring(0, 500));
  console.log('========================');

  let jsonStr = '';

  // 尝试多种方式提取 JSON
  // 方式1: ```json ... ```
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }
  // 方式2: ``` ... ```
  else if (responseText.includes('```')) {
    const codeMatch = responseText.match(/```\s*([\s\S]*?)\s*```/);
    if (codeMatch) jsonStr = codeMatch[1];
  }
  // 方式3: 直接是 JSON 对象
  else if (responseText.trim().startsWith('{')) {
    jsonStr = responseText.trim();
  }

  if (!jsonStr) {
    throw new Error('无法从响应中提取 JSON');
  }

  // 尝试解析
  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    // 尝试修复常见问题
    console.log('首次解析失败，尝试修复...');

    // 修复: 移除末尾的逗号
    let fixed = jsonStr.replace(/,(\s*[}\]])/g, '$1');

    // 修复: 替换中文引号
    fixed = fixed.replace(/[""]/g, '"').replace(/['']/g, "'");

    // 修复: 替换中文冒号
    fixed = fixed.replace(/：/g, ':');

    try {
      return JSON.parse(fixed);
    } catch (e2) {
      console.log('修复后仍然失败，原始内容:', jsonStr.substring(0, 300));
      throw new Error('JSON 解析失败，请重试或换一篇较短的文章');
    }
  }
}

// ============ API路由 ============

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: '服务运行正常',
    apiKeyConfigured: !!GLM_API_KEY && GLM_API_KEY !== 'your_glm_api_key_here'
  });
});

// 获取历史记录
app.get('/api/history', (req, res) => {
  const history = loadHistory();
  res.json({ success: true, data: history });
});

// 删除历史记录
app.delete('/api/history/:id', (req, res) => {
  const { id } = req.params;
  let history = loadHistory();
  history = history.filter(item => item.id !== id);
  saveHistory(history);
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

    // 保存到历史记录
    const historyItem = addHistory({
      title: result.title,
      source: result.source || source || '文本输入',
      data: result,
      inputType: 'text'
    });

    res.json({ success: true, data: result, historyId: historyItem.id });

  } catch (error) {
    console.error('API调用失败:', error);
    res.json({
      success: false,
      error: error.message || '分析失败',
      details: error.toString()
    });
  }
});

// 上传PDF分析
app.post('/api/upload', upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: '请上传文件' });
  }

  try {
    // 读取PDF
    const dataBuffer = fs.readFileSync(req.file.path);
    const pdfData = await pdf(dataBuffer);
    const content = pdfData.text;

    // 删除临时文件
    fs.unlinkSync(req.file.path);

    // 检查内容是否有效
    if (!content || content.trim().length < 100) {
      return res.json({
        success: false,
        error: 'PDF 内容为空或太少',
        details: '可能是扫描版PDF（图片），无法提取文字。请尝试直接粘贴文章文本。'
      });
    }

    console.log(`PDF 解析成功，内容长度: ${content.length} 字符`);
    console.log(`内容预览: ${content.substring(0, 200)}...`);

    // 调用 GLM API
    const responseText = await callGLMApi(content);
    const result = parseJsonResponse(responseText);

    // 保存到历史记录
    const historyItem = addHistory({
      title: result.title,
      source: result.source || req.file.originalname,
      data: result,
      inputType: 'pdf'
    });

    res.json({ success: true, data: result, historyId: historyItem.id });

  } catch (error) {
    console.error('PDF处理失败:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.json({
      success: false,
      error: error.message || '处理失败',
      details: error.toString()
    });
  }
});

// 抓取URL内容
app.post('/api/fetch', async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: '请提供URL' });
  }

  try {
    // 抓取网页内容
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    const html = await response.text();
    const $ = cheerio.load(html);

    // 提取主要内容
    $('script, style, nav, header, footer, aside').remove();

    let content = '';
    $('article, .content, .article, main, #content, .post').each((i, el) => {
      content += $(el).text() + '\n';
    });

    if (!content.trim()) {
      content = $('body').text();
    }

    content = content.replace(/\s+/g, ' ').trim();

    // 调用 GLM API
    const responseText = await callGLMApi(content.substring(0, 50000));
    const result = parseJsonResponse(responseText);

    // 保存到历史记录
    const historyItem = addHistory({
      title: result.title,
      source: result.source || url,
      data: result,
      inputType: 'url',
      url: url
    });

    res.json({ success: true, data: result, historyId: historyItem.id });

  } catch (error) {
    console.error('URL抓取失败:', error);
    res.json({
      success: false,
      error: error.message || '抓取失败',
      details: error.toString()
    });
  }
});

// 启动服务
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     文章总结生成器 v1.1                    ║
║                                            ║
║     访问地址: http://localhost:${PORT}        ║
║     API引擎: 智谱 GLM-4                    ║
║     API Key: ${GLM_API_KEY ? '已配置' : '未配置'}                       ║
║                                            ║
║     使用步骤:                              ║
║     1. 上传PDF / 输入URL / 粘贴文本        ║
║     2. 点击生成总结                        ║
║     3. 下载图片                            ║
╚════════════════════════════════════════════╝
  `);
});
