# 客户充值开放接口文档(免 Token)

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0.0 |
| 适用对象 | 宁夏广电客户对接 |
| 访问域名 | `https://nxgd.ai-models.cloudwasu.cn` |
| 鉴权方式 | **无需 Token**(独立开放接口,仅按 IP 限流防刷) |
| 支付宝商户 | 宁夏广电专属商户(与主站商户独立) |

## 接入约定

| 项目 | 要求 |
|---|---|
| 请求格式 | `Content-Type: application/json` |
| 响应格式 | 统一返回 `code`、`message`、`data`,code=200 表示成功 |
| 鉴权 | 接口在网关白名单中,不需要 JWT 或 API Key |
| 限流 | 按客户端 IP 限流,60 秒内最多 5 次 |

### 统一响应字段

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | integer | 业务状态码,200 表示成功 |
| `message` | string | 响应消息 |
| `data` | object | 响应数据,失败时为 null |

---

## 一、客户开通注册

### 基本信息

| 项目 | 内容 |
|---|---|
| 请求方法 | `POST` |
| 请求路径 | `/api/open/customer/register` |
| 是否需要 Token | 否(独立开放接口,仅按 IP 限流防刷) |
| 接口说明 | 客户提供编码信息,系统以其作为用户名创建账号。租户 = 宁夏广电、用户分组 = 宁夏广电、角色 = 普通用户、密码固定。 |

### 请求参数

| 字段 | 位置 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|---|
| `code` | body | string | 是 | 客户编码,将作为账号用户名 | `"NXGD001"` |

请求示例:

```json
{
  "code": "NXGD001"
}
```

```bash
curl -X POST "http://<网关域名>:8080/api/open/customer/register" \
  -H "Content-Type: application/json" \
  -d '{"code": "NXGD001"}'
```

### 成功响应

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `code` | integer | 200 表示成功 | `200` |
| `message` | string | 响应消息 | `"success"` |
| `data` | object | 账号信息 + 自动注册的 API 令牌 | 见下方结构 |

#### data 字段结构(CustomerRegisterResponse)

| 字段 | 类型 | 说明 |
|---|---|---|
| `user` | object | 账号信息(`username` 即客户编码),结构见 UserDTO |
| `apiKeyName` | string | API 令牌名称(= 客户编码) |
| `apiKey` | string | API 令牌(`sk-` 开头;重复调用返回既有令牌) |

#### user 字段结构(UserDTO,主要字段)

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | integer | 用户 ID |
| `tenantId` | integer | 租户 ID |
| `groupId` | integer | 租户用户组 ID |
| `groupName` | string | 租户用户组名称 |
| `username` | string | 用户名(即客户编码) |
| `role` | integer | 用户角色,0 = 普通用户 |
| `status` | integer | 用户状态,1 = 启用 |
| `quota` | integer | 账号总额度(新开通为 0) |
| `usedQuota` | integer | 账号已使用额度 |
| `balance` | number | 账号余额,单位元(新开通为 0) |
| `usedBalance` | number | 账号已消费金额,单位元 |
| `createdAt` | string | 创建时间 |
| `updatedAt` | string | 更新时间 |

成功响应示例:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "user": {
      "id": 1,
      "tenantId": 1,
      "groupId": 1,
      "groupName": "宁夏广电",
      "username": "NXGD001",
      "email": null,
      "phone": null,
      "emailVerified": true,
      "role": 0,
      "status": 1,
      "quota": 0,
      "usedQuota": 0,
      "allowedModels": null,
      "balance": 0,
      "usedBalance": 0,
      "verificationStatus": 0,
      "verificationType": 0,
      "createdAt": "2026-08-11T10:00:00",
      "updatedAt": "2026-08-11T10:00:00"
    },
    "apiKeyName": "NXGD001",
    "apiKey": "sk-xxxxxxxxxxxxxxxx"
  }
}
```

### 失败响应

失败时统一返回 `code != 200`,常见错误如下:

| code | HTTP 状态码 | message | 说明 |
|---|---|---|---|
| `400` | 200 | 编码不能为空 | 请求体缺少 `code` 或为空 |
| `400` | 400 | 编码不能超过 50 个字符 | `code` 长度超过 50 |
| `400` | 400 | 租户不存在: 宁夏广电,请先在管理后台创建 | 系统内不存在"宁夏广电"租户 |
| `400` | 400 | 编码已被占用 | 该编码已存在且不属于宁夏广电租户 |
| `400` | 400 | 编码已被占用,请勿重复开通 | 并发首次开通撞唯一约束 |
| `500` | 200 | 开通过于频繁,请稍后再试 | 同一 IP 60 秒内超过 5 次 |

失败响应示例:

```json
{
  "code": 400,
  "message": "编码不能为空",
  "data": null
}
```

### 业务规则

1. **账号规则**:用户名 = 客户编码;租户 = 宁夏广电;用户分组 = 宁夏广电(不存在时自动创建);角色 = 普通用户(0);状态 = 启用(1);密码固定为 `2wsx#EDC`(BCrypt 存储)。
2. **幂等**:同一编码重复调用时,若该账号已属于宁夏广电租户,直接返回既有账号与既有 API 令牌,不重复创建。
3. **API 令牌**:开通成功后自动创建名称为客户编码的 API 令牌(`sk-` 开头),用于后续调用模型接口;重复调用返回既有令牌。
4. **限流**:按 IP 限流,60 秒内最多 5 次,超限返回"开通过于频繁,请稍后再试"。

---

## 二、客户余额查询

### 基本信息

| 项目 | 内容 |
|---|---|
| 请求方法 | `GET` |
| 请求路径 | `/api/open/customer/balances` |
| 是否需要 Token | 否(独立开放接口,仅按 IP 限流防刷) |
| 接口说明 | 查询宁夏广电租户下所有用户的余额(`username` 即客户编码)。 |

### 请求参数

无请求参数。

```bash
curl "http://<网关域名>:8080/api/open/customer/balances"
```

### 成功响应

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `code` | integer | 200 表示成功 | `200` |
| `message` | string | 响应消息 | `"success"` |
| `data` | array | 宁夏广电租户下所有用户的余额列表,按创建时间升序 | 见下方结构 |

#### data 数组元素结构

| 字段 | 类型 | 说明 |
|---|---|---|
| `username` | string | 用户名(即客户编码) |
| `balance` | number | 账号余额,单位元 |
| `usedBalance` | number | 账号已消费金额,单位元 |
| `status` | integer | 用户状态,1 = 启用,0 = 禁用 |

成功响应示例:

```json
{
  "code": 200,
  "message": "success",
  "data": [
    {
      "username": "NXGD001",
      "balance": 100.50,
      "usedBalance": 20.00,
      "status": 1
    },
    {
      "username": "NXGD002",
      "balance": 0.00,
      "usedBalance": 0.00,
      "status": 1
    }
  ]
}
```

### 失败响应

| code | HTTP 状态码 | message | 说明 |
|---|---|---|---|
| `400` | 400 | 租户不存在: 宁夏广电 | 系统内不存在"宁夏广电"租户 |
| `500` | 200 | 查询过于频繁,请稍后再试 | 同一 IP 60 秒内超过 5 次 |

失败响应示例:

```json
{
  "code": 500,
  "message": "查询过于频繁,请稍后再试",
  "data": null
}
```

### 业务规则

1. **数据范围**:仅返回"宁夏广电"租户下的全部用户,按创建时间升序排列。
2. **余额口径**:`balance` 为可用余额,`usedBalance` 为累计消费金额,单位均为元;空值按 `0` 返回。
3. **限流**:按 IP 限流,60 秒内最多 5 次,超限返回"查询过于频繁,请稍后再试"。


## 客户充值(支付宝)

### 基本信息

| 项目 | 内容 |
|---|---|
| 请求方法 | `POST` |
| 请求路径 | `/api/open/customer/recharge` |
| 是否需要 Token | 否 |
| 接口说明 | 按客户编码定位账号,创建支付宝充值订单,返回支付宝支付表单 HTML |

### 请求参数

| 字段 | 类型 | 必填 | 说明 | 示例 |
|---|---|---|---|---|
| `code` | string | 是 | 客户编码(开通时使用的 username) | `"NXGD001"` |
| `amount` | number | 是 | 充值金额(元),范围 0.1 ~ 5000 | `100.00` |

请求示例:

```json
{
  "code": "NXGD001",
  "amount": 100.00
}
```

```bash
curl -X POST "https://nxgd.ai-models.cloudwasu.cn/api/open/customer/recharge" \
  -H "Content-Type: application/json" \
  -d '{"code": "NXGD001", "amount": 100.00}'
```

### 成功响应

| 字段 | 类型 | 说明 |
|---|---|---|
| `code` | integer | 200 表示成功 |
| `message` | string | `"success"` |
| `data` | object | 订单与支付信息 |

#### data 字段结构

| 字段 | 类型 | 说明 |
|---|---|---|
| `orderNo` | string | 充值订单号(如 `RC20260911...`) |
| `payFormHtml` | string | 支付宝电脑网站支付表单 HTML,客户端渲染/自动提交后跳转支付宝收银台 |
| `expiresAt` | string | 订单过期时间(默认下单后 5 分钟) |

成功响应示例:

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "orderNo": "RC20260911123045001",
    "payFormHtml": "<form name=\"punchout_form\" method=\"post\" action=\"https://openapi.alipay.com/gateway.do?charset=utf-8&...\">...</form>",
    "expiresAt": "2026-09-11T12:35:45"
  }
}
```

#### payFormHtml 使用方式

把 `payFormHtml` 直接写入客户页面,并自动提交:

```html
<!-- 服务端/前端将接口返回的 payFormHtml 嵌入页面后自动提交 -->
<div id="alipay-wap-pay" style="display:none">
  ${payFormHtml}
</div>
<script>
  document.querySelector('#alipay-wap-pay form').submit();
</script>
```

提交后浏览器会跳转到支付宝收银台,客户完成付款。

### 失败响应

| code | message | 说明 |
|---|---|---|
| 400 | 编码不能为空 | 未传 `code` |
| 400 | 金额不能为空 / 金额格式不正确 | `amount` 缺失或非法 |
| 400 | 充值金额需在 0.1 ~ 5000 元之间 | 超出范围 |
| 400 | 客户不存在: xxx | 该编码未开通(先调用 `/api/open/customer/register`) |
| 400 | 客户编码不属于宁夏广电租户 | 编码对应账号不属于宁夏广电 |
| 400 | 当前存在待支付订单,请先取消支付或继续完成支付 | 上一单未支付/未关闭 |
| 500 | 充过于频繁,请稍后再试 | 触发 IP 限流(60 秒 5 次) |

失败响应示例:

```json
{
  "code": 400,
  "message": "客户不存在: NXGD001",
  "data": null
}
```

---

## 支付结果与到账

1. 客户在支付宝完成付款后,支付宝异步回调 `https://nxgd.ai-models.cloudwasu.cn/api/pay/alipay/notify`,系统自动把金额加到客户账号余额;
2. 到账一般几秒内完成,客户用**自己的编码**查询余额确认:

```bash
# 客户只查自己的余额(传 code)
curl "https://nxgd.ai-models.cloudwasu.cn/api/open/customer/balances?code=NXGD001"
```

```json
{
  "code": 200,
  "message": "success",
  "data": {
    "username": "NXGD001",
    "balance": 100.00,
    "usedBalance": 20.00,
    "status": 1
  }
}
```

`balance` 增加即代表充值已到账。编码不存在时返回 `客户不存在: xxx`。

3. 订单 5 分钟未支付自动过期;过期后如需再充,重新调用充值接口即可。

## 配合使用的开放接口

| 接口 | 说明 |
|---|---|
| `POST /api/open/customer/register` | 客户开通注册(按编码创建账号) |
| `GET /api/open/customer/balances?code=客户编码` | 查询**该客户**的余额(客户自助) |
| `GET /api/open/customer/balances` | 查询宁夏广电租户下全部客户余额(平台方对账用,客户侧不建议使用) |
| `POST /api/open/customer/recharge` | 客户充值(支付宝) |
