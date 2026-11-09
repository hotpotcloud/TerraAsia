# -*- coding: utf-8 -*-
"""工程路径与目录约定的唯一来源。

所有管线脚本都从这里取路径，不要各自再拼 dirname(dirname(__file__))。

目录约定
--------
    data/source/     权威输入：国界、省界、十段线（入库）
    data/datasets/   由脚本生成、但需要入库的数据集：cities.json
    data/cache/      可重新下载的缓存：DEM 瓦片、地级市原始 JSON（不入库）
    build/           中间产物（不入库）
                     data.json       prep_data 产出，地形 PNG 带 alpha（原始掩膜）
                     data.split.json split_mask 产出，alpha 已拆出为 maskPng
    app/             前端工程（Vite + React + R3F），源码入库
    app/public/data/ 前端运行时数据（由 publish_data / prep_world 产出，不入库）
    dist/            最终交付物：静态站点（不入库）
"""
import os

PIPELINE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(PIPELINE_DIR))

DATA_DIR = os.path.join(ROOT, "data")
SOURCE_DIR = os.path.join(DATA_DIR, "source")
DATASET_DIR = os.path.join(DATA_DIR, "datasets")
CACHE_DIR = os.path.join(DATA_DIR, "cache")

BUILD_DIR = os.path.join(ROOT, "build")
APP_DIR = os.path.join(ROOT, "app")
APP_DATA_DIR = os.path.join(APP_DIR, "public", "data")
DIST_DIR = os.path.join(ROOT, "dist")
WEB_DIR = os.path.join(ROOT, "src", "web")

BUILD_JSON = os.path.join(BUILD_DIR, "data.json")
BUILD_SPLIT_JSON = os.path.join(BUILD_DIR, "data.split.json")
OUT_HTML = os.path.join(DIST_DIR, "亚洲三维地形沙盘-产品原型.html")

# 常用输入文件
BOUND = os.path.join(SOURCE_DIR, "china_bound.json")
BOUND_FULL = os.path.join(SOURCE_DIR, "china_bound_full.json")
TEN_DASH = os.path.join(SOURCE_DIR, "ten-dash-line.gmt")
CITIES_JSON = os.path.join(DATASET_DIR, "cities.json")
