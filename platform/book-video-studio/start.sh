#!/bin/bash
# Book Video Studio 一键启动脚本

set -e

PROJECT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$PROJECT_DIR"

echo "📦 Book Video Studio 启动中..."
echo "项目目录: $PROJECT_DIR"
echo ""

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未找到 Node.js，请先安装 Node.js 20+"
    exit 1
fi
echo "✅ Node.js $(node --version)"

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo "⚠️  首次启动，正在安装依赖..."
    npm install
fi

# 检查 .env
if [ ! -f ".env" ]; then
    echo "⚠️  未找到 .env 文件"
    if [ -f ".env.example" ]; then
        echo "   正在从 .env.example 创建 .env..."
        cp .env.example .env
        echo "   ⚠️  请编辑 .env 填入密钥后重新运行本脚本"
        exit 1
    else
        echo "❌ 缺少 .env.example，请手动创建 .env"
        exit 1
    fi
fi
echo "✅ .env 配置已就绪"

# 检查数据库
if [ ! -f "data/app.db" ]; then
    echo "⚠️  首次启动，正在初始化数据库..."
    npm run db:push
fi
echo "✅ 数据库已就绪"

# 修复 better-sqlite3（如果 Node 版本变更）
echo "🔧 检查原生模块..."
if ! node -e "require('better-sqlite3')" 2>/dev/null; then
    echo "⚠️  原生模块版本不匹配，正在重建..."
    npm rebuild better-sqlite3
fi
echo "✅ 原生模块正常"

# 启动服务
echo ""
echo "🚀 启动开发服务器..."
echo "   本地访问: http://localhost:3000"
echo "   按 Ctrl+C 停止服务"
echo ""

npm run dev
