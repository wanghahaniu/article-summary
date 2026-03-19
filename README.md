# 文章总结生成器

将复杂文章转化为结构清晰、重点突出的问答式总结，并生成精美图片。

## 功能特点

- ✅ 自动分析文章核心内容
- ✅ 按五步法设计精准问题
- ✅ 生成精美卡片式总结
- ✅ 支持导出高清PNG图片
- ✅ 支持PDF、URL、文本三种输入
- ✅ 历史记录功能
- ✅ 智谱GLM-4驱动

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置API Key

复制 `.env.example` 为 `.env`，并填入你的智谱API Key：

```bash
cp .env.example .env
```

编辑 `.env` 文件：
```
GLM_API_KEY=your_glm_api_key_here
```

获取API Key: [open.bigmodel.cn](https://open.bigmodel.cn/)

### 3. 启动服务

```bash
npm start
```

### 4. 访问页面

打开浏览器访问: http://localhost:3000

## 问题设计五步法

1. **本质层**：核心变化/冲突是什么？
2. **机制层**：关键驱动机制是什么？
3. **变量层**：关键变量/转折点是什么？
4. **预期差**：作者与市场共识有何分歧？
5. **角色层**：谁推动？谁受益？谁受损？

## 技术栈

- 前端：原生 HTML/CSS/JS
- 后端：Node.js + Express
- AI引擎：智谱 GLM-4
- 截图：html2canvas

## 项目结构

```
article-summary-demo/
├── public/
│   └── index.html      # 前端页面
├── server.js           # 后端服务
├── package.json        # 依赖配置
├── .env.example        # 环境变量示例
├── .gitignore
└── README.md
```

## License

MIT
