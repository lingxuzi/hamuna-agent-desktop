---
name: ops-intake
description: >-
  物料入库。把工作区 ops/inbox/ 里人丢进来的原始物料（产品图 + 一段产品说明）变成台账里
  的一条素材，并把原件归档到 ops/assets/imported/。
  当用户说「物料同步好了」「把 inbox 收一下」「这批图入库」时用这个 skill。
---

# ops-intake — 物料入库

人往运营里投的只有两样东西：**原始物料** 和 **要宣传的产品**。这个 skill 把它们变成台账里
一条 `draft` 素材，做稿是 `ops-produce` 的事。

## 开工前先读

```bash
ls ops/inbox/                 # 有几个批次
hamuna ops list asset --json   # 手上有没有同名的，别重复入库
```

## 目录约定

```
ops/inbox/<批次名>/
  brief.md        # 产品说明，人写的（可选，但强烈建议）
  1.jpg 2.jpg     # 物料文件，随便什么
```

**一次物料 = 一个文件夹。** 文件夹名就是批次名。

`brief.md` 是人写给人看的自由格式，Sino 自己读。里面写什么都是好的：

```markdown
# 露营折叠桌 · 主推款
平台：抖音
产品：露营折叠桌
希望观众：进店看新款
卖点：铝合金一体成型、10 秒展开、收起来只有水瓶大
禁用词：最便宜、国家级、绝对
```

`brief.md` 里该有的：产品名、要观众做的动作、卖点、禁用词、平台。**没有就留空，不要编。**

禁用词如果同时写在 `brief.md` 和 `03-USER.md`，以 `03-USER.md` 为准——账号级的规矩只留一份。

## 入库

1. 读 `ops/inbox/<批次名>/brief.md`（没有就只看文件名和 `03-USER.md`）。
2. 定四个值：title / platform / product / cta。缺哪个留哪个，不要拿别的顶。
3. **先把原件搬走**——搬完才写账本，路径才不会写错：

   ```bash
   mkdir -p ops/assets/imported/$(date +%F)
   mv ops/inbox/<批次名> ops/assets/imported/$(date +%F)/
   ```

   目标目录已经存在就换个名字（`-2`、`-3`），别把批次塞进已有目录里变成两层。

4. 记一条素材：

   ```bash
   hamuna ops add asset \
     --title "露营折叠桌 · 主推款" \
     --platform douyin \
     --product "露营折叠桌" --cta "进店看新款" \
     --source-ref ops/assets/imported/2026-11-15/折叠桌 \
     --image ops/assets/imported/2026-11-15/折叠桌/1.jpg \
     --image ops/assets/imported/2026-11-15/折叠桌/2.jpg \
     --progress 10
   ```

   批次里的图逐张 `--image`；有现成文案就 `--body-file` 指到搬过去的那个文件。

5. `progress` 给 **10**。文件搬进来了，稿子一个字还没写。

## 幂等靠搬家，不靠标记文件

**搬走本身就是「处理过了」。** 不另设状态文件、不另建索引——文件不在 `ops/inbox/` 了，
下一次巡检自然扫不到它。原件留在 `ops/assets/imported/` 下，不删。

搬完了但账本没记上（上一轮中途断了）会在 `ops/assets/imported/` 里留一个没被任何素材引用的
批次目录。看到这种目录 → 照上面第 4 步补一条素材，`--source-ref` 指过去。

## 不要做

- **别动 `ops/inbox/` 里没准备搬走的东西。** 人正在往里丢文件，你改了他不知道。
- 一次搬一个批次文件夹。散落在 `ops/inbox/` 根目录的文件先问用户，别自己猜是哪批的。
- 不要替用户改 `brief.md`。那是人的输入，改了就失去意义。
- **不要直接编辑 `ops/state.json`。**
