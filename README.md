# dsh-peak-badge

点一下就知道现在 DeepSeek 是按**高峰价**还是**空闲价**计费。

组件是一个小胶囊（chip），挂在输入框工具行的最左边（`conversation.input.left`）。
胶囊左边一个小圆点，颜色跟着状态走：高峰是琥珀色，空闲是中性色。
点开是一张小卡片，写着当前状态、计费方式、下次切换的时间和倒计时，以及此刻**为什么**是这个状态。

## 计费规则

来自 [DeepSeek 官方定价页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)：

> 北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；
> 其余时段，包括周末及中国法定节假日全天均为空闲时段。

> 空闲时段价格为高峰时段价格的一半。

所以谷时是 5 折。周末整天、法定节假日整天，无论几点都是谷时。

判定完全在浏览器里算：读本机时钟，换算成北京时间，再查一张硬编码的节假日表。
不发任何网络请求，不依赖 DeepSeek 的接口——价格表什么时候变，那是官方定价页的事，
这个插件只回答「现在落在哪一档」。

## 装

需要 DSH（DeepSeek Harness）桌面端或 Web 端。

**方式一：命令行**（推荐，能自动热加载）

```
dsh plugin --profile <你的 profile 名> add @tuoluosuan/dsh-peak-badge
```

profile 名就是侧栏「工作区」对应的那个（桌面端默认 `desktop`）。**方式二：直接从仓库装**（不经过 npm，跟着 `main` 分支走）

```
dsh plugin --profile desktop add github:tuoLuoSuan/dsh-peak-badge
```

**方式二：在对话里让 DSH 自己装**

```
plugin_manager action: install_bundle target: @tuoluosuan/dsh-peak-badge
```

**方式三：本地开发**

```
plugin_manager action: install_bundle target: D:\path\to\dsh-peak-badge
```

`target` 接受包名（可带版本）、git 地址、tarball 或本地绝对路径，所以从克隆下来的目录直接装也行。

装完刷新页面。**替换已装版本需要重启**才能加载新代码（热加载只覆盖新装的 bundle）。

### 装不上或者想卸载

```
plugin_manager action: list_bundles
plugin_manager action: remove_bundle target: @tuoluosuan/dsh-peak-badge
```

`list_plugins` 里应该能看到 `@tuoluosuan/dsh-peak-badge` 且 `fiberPhase: active`。

## 自己验一遍（推荐）

面板上的数字是算出来的，所以这里有能跑的证明：

```
node verify-policy.mjs
```

在仓库根目录直接 `node verify-policy.mjs`，在归档区那种外面套一层目录的地方则是
`node dsh-peak-badge/verify-policy.mjs`，都一样。

它把 `client.js` 里 `#region policy` 到 `#endregion` 之间那段（纯函数，无 React、无 DOM、
无服务）抠出来执行，跑八十多条断言：节假日表 33 天逐个对名字、四种边界分钟（9:00 / 12:00 /
14:00 / 18:00）的开闭、周末与节假日全天、调休日、秒数对齐、跨年拒绝回答、时区无关性，
以及两个曾经真的算错过的场景——工作日 12:30（必须说「今天 14:00」，曾经说「明天 09:00」）
和周五 20:00（必须说「3 天后 09:00」，曾经说「明天 09:00」，而那是周六）。

它接着把 `#region text` 那段也抠出来（`new Function` 包一层，塞一个假的 `locale` 服务进去），
验两种语言的数字格式、日期偏移词、每一句理由整句、以及中英来回切换之后中文能不能回来
——最后一类是真实存在过的 bug：恢复中文的路径曾经是一份手抄的字面量表，抄漏了一个键。

最后一段是**两段合起来**验的：同一个 `new Function` 里先放 policy 再放 text，
然后真正按卡片的方式跑一遍 `reasonSentence(peakState(...))`。分开验时两边都是手喂的假数据，
所以 policy 把 `{ name: ... }` 改名、或者模板里把 `{name}` 打错，都能全绿通过——
而卡片上会直接印出 `{name}`（`fill` 是故意把缺失的占位符留在原地的）。
这一段就是为了堵这个缝，并且额外盯住 `dateText` / `weekday` / `schedule` 三个
别的断言都没碰过的字段。

**时区**：DSH 跑在用户本机时区上，而答案永远是北京时间的。这条靠测试确认，不靠推理——
上面有一组专门的断言，并且整个文件可以在别的时区下重跑（`TZ` 环境变量 Node 会读）：

```
TZ=UTC                  node verify-policy.mjs
TZ=America/New_York     node verify-policy.mjs
TZ=Asia/Shanghai        node verify-policy.mjs
TZ=Pacific/Kiritimati   node verify-policy.mjs
```

四个时区都是 88 条全过。把 `peakState` 里的 `getUTC*` 换成 `get*`（一个很自然的
「简化」），这套断言立刻挂——验证过，不是推测。

退出码按本工作区的约定分三种：`0` 全过，`1` 有断言挂了（**代码错了**），
`2` 根本没跑起来（与代码无关）。加了 `--dump` 会把抠出来的那段代码打出来。
最后还压了一条底线：跑过的条数少于预期（现在是 88）也一样按 1 退出，
否则「某个小节整段没跑」会打印成「0 passed, 0 failed」然后安安静静地返回 0。

> 关于这套断言的可信度：写它的时候，我**手算的期望值错了六次，机器每次都对**。
> 所以别相信「我看了一眼觉得对」，改动之后跑一遍。

## 一个刻意的选择：调休日按周末算

调休上班日（2026 年是 1/4、2/14、2/28、5/9、9/20、10/10）虽然是「上班日」，
但它们落在周六或周日。官方规则逐字写的是「包括**周末**……均为空闲时段」，
所以这里**按字面执行**：调休日一律算谷时。

卡片会在这种日子明说这件事，而不是默默按某个解释算：

> 调休上班日，但官方规则按周几算，周末一律空闲（周六），全天按空闲时段计价。

如果你认为调休日该按上班日算，改一处即可：`client.js` 里让 `peakState` 的
`isMakeup` 判定同时要求「不是周末」，工作日分支就会接住它。**不要**只改文案
——文案和判定必须一起改，否则卡片会理直气壮地说反话。

`verify-policy.mjs` 里有一条专门盯这个的走查：周五 20:00 必须跨过调休的周六 5/9
走到周一 09:00；把调休算成工作日，它会答「周六早上」，该断言立刻挂。

## 跨年：表外的年份说「不知道」

法定节假日表只有国务院当年那份通知是权威的，所以它是硬编码的
（2026 年那 33 天来自[国务院办公厅关于 2026 年部分节假日安排的通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)，国办发明电〔2025〕7 号）：

- `client.js:56-74` — `HOLIDAY_TABLE`（2026 年七行节假日 + 调休上班日）
- `client.js:77-80` — `HOLIDAY_COVERAGE` / `LATEST_COVERED_YEAR`

覆盖范围是**从表本身推出来的**（`Object.values(HOLIDAY_TABLE).map((e) => e.year)`），
不是另写一个 `[2026]` 常量：年份同时喂给 `Date.UTC` 和「表到哪年」的检查，
两边不可能对不上。加一年就是往 `HOLIDAY_TABLE` 里再放一条。

到了表外的年份，徽章**不会猜**，而是显示「未知」并说明原因：

> 节日表只到 2026 年，2027 年的法定节假日无从判断。

这是故意的。一个在元旦当天还自信地说「峰时」的徽章，比一个承认自己不知道的徽章更糟
——它会在你最需要它准的时候骗你。明年出了新通知，把上面三处换掉即可。

（顺带一提：还有别的同类插件在这种情况下会退化成「工作日按周一至周五推算」并照常给出
下次切换时间。那更有用，但也更可能说错。这里选了诚实那一边。）

## 文件

| 文件 | 作用 |
|---|---|
| `package.json` | 包定义：`dsh.bundle.patch`、`dsh.client`（`platform: web`、`immediately`）、`icon`、`exports` |
| `cordis.patch.yml` | 往 profile 里插一行插件 |
| `index.js` | 宿主半边，空的 |
| `client.js` | 全部功能：策略 + 渲染 |
| `verify-policy.mjs` | 上面那个能跑的证明 |
| `locale/{en,zh}.json` | 插件列表里显示的名字和说明（`meta.title` / `meta.description`） |
| `icon.svg` | 插件列表里的图标，`currentColor`，跟随主题 |

宿主半边（`index.js`）是空的：策略只依赖北京时间与节假日表，没有要抓的东西、
也没有要排的活，没必要为了对称塞点东西进去。整个功能都在 `client.js`。

`meta.title` / `meta.description` 由平台从 `locale/<语言>.json` 读，读不到就退回
`package.json` 的 `name` / `description`——所以没有这两个文件时，插件列表里显示的是
`@tuoluosuan/dsh-peak-badge` 这种模块名。`exports` 里必须放开 `./locale/*.json`，
否则平台的解析器拿不到它（`exports` 是白名单）。

`client.js` 用 `#region` 分成四段：`policy`（纯函数，可单独抠出来执行）、
`styles`、`text`（语言表与两个格式化函数）、`view`（React）。
其中 `#region policy` / `#region text` 的边界是 `verify-policy.mjs` 依赖的约定，
改结构时别把它们删了。

判定与文案是分开的：`peakState` 只返回**键和数字**（`reason: 'makeup'`、
`next: { at, inDays, leftMinutes }`），句子在 `#region text` 里拼。
这条边界就是 `verify-policy.mjs` 能单独执行这两段的原因——一旦 policy 里出现
`text.xxx`，验证脚本会立刻抛 `ReferenceError`（真发生过一次）。

## 不能改坏的五件事

1. **时间只能从 `ctx.get('timer')` 拿。** 反复执行的东西走
   `ctx.get('timer').interval(cb, ms)`，一次性延时走 `timeout`；两种都返回 disposer。
   定时器要在 `React.useEffect` 里创建、把 disposer 当清理函数交回去。
   服务查询和 `interval()` 都要包在 `try` 里——上下文一旦销毁，`ctx.effect`
   会抛 `INACTIVE_EFFECT`，而卸载和销毁本来就是会撞车的。
   别改用全局 `setTimeout`：动态客户端包里它是会抛错的陷阱（`client.js:49-56`），
   而且即使在这里能用，它也不跟页面生命周期绑定，卸载后会继续跑。同理，语言切换
   靠的是 `locale.subscribe`，不是重新加载。

2. **周几要按「那一刻」算，不能按「那一天」算。** 北京时间的周五 18:00 之后就是谷时，
   一直谷到周一早上；如果周几取自当天日期，周五晚上就会被算成工作日峰时。
   代码读的是那个瞬间本身（`peakState` 里的 `shifted`）。

3. **`offPeakReach` 里必须有两个时钟。** 今天（`inDays === 0`）按**此刻的分钟**判定，
   之后每一天按**零点**判定。两者缺一不可：都用此刻，18:00 之后每一天都「已经过了
   今天的窗口」，整条走查会返回「找不到」；都用零点，12:30 的午休会答成
   「09:00 还没到」。这个坑两边都踩过。

4. **注入的 `<style>` 必须带 `data-plugin`。** `dsh-client-modules` 的
   `removeOwnedStyles`（`lib/client.js:194-197`）只清 `style[data-plugin]`，
   而且是在工厂失败和版本切换时清。少了这个属性，卸载后样式会留在页面上，
   下一个版本的规则就会和旧规则打架。

5. **指针离开文档（`relatedTarget === null`）不算「点到外面」。** 那种情况要留着卡片开着：
   关掉会让卡片在自己的 mouseup 之前卸载，卡内任何可点的东西就永远点不动了。
   外面点击由胶囊自身的开关收场，键盘由 Escape 收场。

## 两个踩过的渲染坑

**颜色别用 `--dsw-alias-state-idle-primary`。** 它在浅色主题下是 `--dsw-static-neutral-300`，
也就是 **#d4d4d4**——那是画边框用的灰，1.2:1，在白底输入行里几乎看不见（第一版就是这样，
被用户抓到了）。谷时/未知改用 `--dsw-alias-label-secondary`（中性蓝灰 #61666b，约 5.0:1），
它在浅色和深色主题下都跟着走。

**圆点要显式写 `corner-shape: round`。** 主题装了一条全局规则
`*, :before, :after { corner-shape: var(--dsw-corner-shape) }`，而那个变量是
`superellipse(1.5)`（`dsh-client-ui-theme/lib/client.js:1145`）。在支持的浏览器里，
一个 6px 的 `border-radius: 50%` 方块不会被这个规则收成圆——超椭圆在 6px 上边是平的，
**它渲染成一个圆角方块**。放大 10 倍渲染两种写法对比过：只有显式 `round` 才是正圆。
不支持的引擎会忽略这条声明，所以可以无条件留着。

## 卡片往上弹，不会被裁掉

卡片的定位是 `position: absolute; bottom: calc(100% + 8px)`，必然要向上溢出输入框那一行，
所以专门查过一遍输入框祖先链会不会 `overflow: hidden` 把它切掉——**不会**：
`.card` / `.root` / `.dock` / `.composerSeat` 都不声明 overflow，带 `overflow-y: auto` 的
`.scroll` 是卡片里那段**文字**的滚动区，胶囊所在的那一行是它的兄弟节点而不是子节点。
平台自己也有两个同样往上弹、同样不用 portal 的先例：
`dsh-client-ui-input-trigger` 的 `.Z9Jnlq_menu`（`lib/client.js:976`）和
`dsh-client-ui-commands` 的 `.EhuiKa_card`（`lib/client.js:1166`），
都是 `bottom: calc(100% + 4px)` 的绝对定位。所以这里不需要 portal。

样式只用 `--dsw-alias-*` 主题令牌，不引任何 Harness Client 包，
不往 `document.body` 上挂东西。

## 无障碍

胶囊是一个真的 `<button>`：`aria-expanded` / `aria-controls` / `aria-haspopup="dialog"`，
`title` 里带完整状态；卡片是 `role="dialog"`；圆点本身是 `aria-hidden`（颜色只是重复文字）。
键盘：Tab 能聚焦，Escape 关卡片。因为它在输入行里、不在 `aria-hidden` 子树里，
所以不需要额外的屏幕阅读器播报区（有些同类插件需要，是因为它们把徽章放进了品牌行）。

## 和别的同类插件比

做之前不知道已经有人做过，做完才发现有五六个，核心判定完全一致
（包括调休怎么算、节假日表逐条相同）。功能上的差别大致是：

- 这里点开是**卡片**（有的同类是悬停 tooltip 或只切换显示档位）
- 这里会写出**节假日的名字**（春节 / 国庆节），不只是「法定节假日」
- 这里**跨年会明确说不知道**，而不是猜

参考过的项目：[AK-blank/dsh-plugin-offpeak-badge](https://github.com/AK-blank/dsh-plugin-offpeak-badge)、
[dsh-peak-badge](https://www.npmjs.com/package/dsh-peak-badge)、
[future007s/dsh-peak-indicator](https://github.com/future007s/dsh-peak-indicator)、
[blueziii/dsh-peakvalley](https://github.com/blueziii/dsh-peakvalley)。

## 验的时候别只验一半

分两段验很自然——两段本来就能各自单独执行——但它有个盲点：**缝上的错两边都看不见**。
policy 交出 `reasonParams`，text 拿模板去填；分开验时两边喂的都是手写的假数据，
所以把 `{ name: holiday }` 改名、或者在 `REASON_ZH` 里把 `{name}` 打错，
八十多条断言照样全绿，而卡片上印的是字面量 `{name}`。

所以 `verify-policy.mjs` 末尾有一段用**同一个 `new Function`**（先 policy 后 text）
把整条路走一遍：`reasonSentence(peakState(那一刻))`，再顺手扫一遍所有可能出现的理由键，
确认没有任何 `{...}` 残留。往这个文件里加东西时，
「新加一条断言」比「多看一眼」便宜得多——理由见上面那个引用块。

## License

MIT
