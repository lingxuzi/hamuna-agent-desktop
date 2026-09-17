# Protected Fields（角色身份保护 · AdCraft `role_prompt_authoring`）

> **目的**：character_turnaround 的 protected 字段必须**精确传递**，不意译/不总结/不翻译/不丰富化。防止 #8B-1 角色身份漂移（女主名错"小鹿"应为"林小溪" / Scene 错锁"禁止男性入镜"应为允许男主江屿入镜）。
>
> **来源**：AdCraft `video_agent_role_prompt_authoring` capability

---

## 一、7 个 Protected 字段（不可改）

| # | 字段 | 说明 | 不可改的原因 |
|---|---|---|---|
| 1 | `identity` | name / age / gender / ethnicity | 锚脸基础 |
| 2 | `face and hair` | 发型发色 / 五官 | 锚脸基础 |
| 3 | `silhouette and proportions` | 体型比例 | 锚脸基础 |
| 4 | `wardrobe` | 服装 | 跨段一致性 |
| 5 | `accessories` | 配饰 | 跨段一致性 |
| 6 | `rendering mode` | CG / 写实 / 二次元 | 风格一致性 |
| 7 | `gender presentation` | 性别表达 | 政治正确 |

---

## 二、Editable Prompt（可写）

只描述 requested turnaround presentation：
- 站位（front-view / 3/4 / side）
- 构图（full-body / portrait / close-up）
- 灯光（clean studio frontal lighting / 3-point）

**不能替换 protected fields**。

---

## 三、Prompt 嵌入模板

```python
prompt = f"""
[protected · 不能改]
{character.identity_master}

[editable · 可写]
composition: front-view portrait anchor sheet
lighting: clean studio frontal lighting
"""
```

---

## 四、失败模式

### #8B-1 角色身份漂移（实证翻车）

- **触发**：Round 2b Character 漏读 world_setting → Character JSON 抄了 Scene 的 "禁止男性入镜" 锁死指令（不当覆盖），结果男主江屿被错误排除
- **修复**：
  1. Character 必须显式 read agent_world_setting.json
  2. Protected 字段用 `[{protected}...]` 包裹显式声明
  3. Editable prompt 写完后做"非覆盖校验"：grep protected 字段是否完整保留

### #8B-2 角色 Agent 输出污染场景

- **触发**：Character JSON 含场景描述（与 Scene Agent 输出重叠）
- **修复**：Character Agent prompt 明确限制"只输出 9 字段人物特征，不写场景"

---

## 五、与 Scene/Prop 的边界

| 维度 | Character | Scene | Prop |
|---|---|---|---|
| Protected 字段 | 7 个（identity 等） | location / lighting / tone / props / depth / forbidden | name / material / color / silhouette / scale / brand_relation |
| 谁来读 world_setting | ✅ 必读 | ✅ 必读 | ✅ 必读 |
| editable 范围 | 站位 / 构图 / 灯光 | 镜头组 / 场景锁定指令 | 跨段锁定指令 |
| Round 2b 严禁完全并行 | 是 | 是 | 是 |

---

## 六、9 字段 character_turnaround Schema（完整）

```json
{
  "character": {
    "identity_master": {
      "name": "<姓名/代号>",
      "gender": "<性别>",
      "age_range": "<年龄区间>",
      "ethnicity": "<种族/肤色>",
      "hair": "<发型发色>",
      "body": "<体型>",
      "outfit": "<服装>",
      "accessory": "<配饰>",
      "expression": "<表情基调>"
    },
    "three_views": ["<正面>", "<左45°>", "<右45°>"],
    "three_view_prompts": ["<image_generate prompt 1>", "<prompt 2>", "<prompt 3>"]
  }
}
```

---

## 七、validation（必跑）

每跑完 Character Agent，验证：
- [ ] identity_master 9 字段全填
- [ ] three_view_prompts 长度 = 3
- [ ] protected 字段未在 editable prompt 中被覆盖（grep 检查）
- [ ] 不含 scene 描述（避免 #8B-2 污染）