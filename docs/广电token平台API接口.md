# 客户开放接口文档(免 Token 鉴权)

## 文档信息

| 项目 | 内容 |
|---|---|
| 文档版本 | 1.0.0 |
| 适用对象 | 宁夏广电客户对接 |
| 接口根地址 | 按部署环境配置,例如 `http://<网关域名>:8080` |
| 鉴权方式 | **无需 Token**(JWT 与 API Key 均不需要),接口按 IP 限流防刷 |

## 接入约定

| 项目 | 要求 |
|---|---|
| 请求格式 | `Content-Type: application/json` |
| 响应格式 | 统一返回 `code`、`message`、`data` 三个字段,`code = 200` 表示业务处理成功 |
| 鉴权 | 两个接口均在 `SecurityConfig` 中 `permitAll()`,不经过 JWT 鉴权链路 |
| 限流 | 每个接口按客户端 IP 限流,60 秒内最多 5 次;Redis 故障时限流自动放行 |

### 统一响应字段

| 字段 | 类型 | 说明 | 示例 |
|---|---|---|---|
| `code` | integer | 业务状态码,200 表示成功 | `200` |
| `message` | string | 响应消息 | `"success"` |
| `data` | object / array | 响应数据,失败时为 `null` | `{...}` |

## 接口清单

| 方法 | 路径 | 接口说明 | 是否需要 Token |
|---|---|---|---|
| `POST` | `/api/open/customer/register` | 客户开通注册(按客户编码创建账号) | 否 |
| `GET` | `/api/open/customer/balances` | 查询宁夏广电租户下所有用户余额 | 否 |

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

---

## 鉴权与限流说明

- 两个接口路径已配置在 `SecurityConfig.java` 的 `permitAll()` 白名单中,请求无需携带 `Authorization` 头或 `sk-` API Key。
- 接口内部通过 `RateLimitService` 按客户端 IP 限流(取 `X-Forwarded-For` 首个 IP,其次 `X-Real-IP`,最后直连 IP),防止刷接口。
- Redis 异常时限流自动放行,不影响正常业务。
