---
title: "Web MIDI 输入"
summary: "接一台真实的 MIDI 键盘，直接弹浏览器里的钢琴音源。"
lang: zh
status: online
order: 2
---

用 Web MIDI API 读取输入设备。Note On 触发声音，Note Off 释放；力度决定音量，弹奏时网页上的对应琴键会同步高亮。

浏览器不支持时只显示一行 `MIDI / NOT SUPPORTED`，不会弹窗。
