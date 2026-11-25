import { t } from './config';
import { redact } from './files';
import { HttpError } from './network';

const messages: [string, string, string][] = [
  ['Invalid instance group', '实例分组名称无效', '實例分組名稱無效'],
  ['Instance group not found.', '实例分组不存在。', '實例分組不存在。'],
  ['Invalid instance import selection.', '实例导入选择无效。', '實例匯入選擇無效。'],
  [
    'Select between 1 and 2000 instances.',
    '请选择 1 到 2000 个实例。',
    '請選擇 1 到 2000 個實例。',
  ],
  ['Invalid JSON response from', '返回了无效 JSON 的服务：', '返回了無效 JSON 的服務：'],
  [
    'Enable Terracotta Beta in Settings first.',
    '请先在设置中开启陶瓦联机 Beta。',
    '請先在設定中開啟陶瓦連線 Beta。',
  ],
  [
    'Read and accept the Terracotta notices first.',
    '请先阅读并确认陶瓦联机须知。',
    '請先閱讀並確認陶瓦連線須知。',
  ],
  [
    'Confirm both Terracotta notices to continue.',
    '请勾选两项陶瓦联机确认后继续。',
    '請勾選兩項陶瓦連線確認後繼續。',
  ],
  [
    'Download Terracotta or choose its executable first.',
    '请先下载陶瓦或选择其可执行文件。',
    '請先下載陶瓦或選擇其執行檔。',
  ],
  ['Choose the Terracotta executable.', '请选择陶瓦可执行文件。', '請選擇陶瓦執行檔。'],
  [
    'Install the official Terracotta package on macOS before connecting.',
    '连接前请先在 macOS 上安装陶瓦官方安装包。',
    '連接前請先在 macOS 上安裝陶瓦官方安裝套件。',
  ],
  [
    'No official Terracotta build is available for this platform.',
    '当前平台没有可用的陶瓦官方构建。',
    '當前平臺沒有可用的陶瓦官方建置。',
  ],
  [
    'No verified Terracotta download is available.',
    '未找到可校验的陶瓦下载文件。',
    '未找到可驗證的陶瓦下載檔案。',
  ],
  ['Invalid Terracotta archive.', '陶瓦压缩包无效。', '陶瓦壓縮包無效。'],
  [
    'Terracotta archive exceeds size limit.',
    '陶瓦压缩包超过大小限制。',
    '陶瓦壓縮包超過大小限制。',
  ],
  [
    'Terracotta executable was not found in its package.',
    '安装包中未找到陶瓦可执行文件。',
    '安裝套件中未找到陶瓦執行檔。',
  ],
  [
    'Terracotta could not start. Check its installation.',
    '陶瓦未能启动，请检查安装。',
    '陶瓦未能啟動，請檢查安裝。',
  ],
  [
    'Terracotta did not provide its local API address in time.',
    '陶瓦未能及时提供本地接口地址。',
    '陶瓦未能及時提供本機介面位址。',
  ],
  ['Invalid Terracotta handshake.', '陶瓦接口握手无效。', '陶瓦介面握手無效。'],
  [
    'Unsupported Terracotta local API.',
    '此陶瓦本地接口版本不受支持。',
    '此陶瓦本機介面版本不受支援。',
  ],
  ['Connect Terracotta first.', '请先连接陶瓦组件。', '請先連接陶瓦元件。'],
  ['Unsupported Terracotta state.', '无法识别陶瓦当前状态。', '無法識別陶瓦當前狀態。'],
  ['Invalid Terracotta relay URL.', '陶瓦中继节点地址无效。', '陶瓦中繼節點位址無效。'],
  ['Leave the current Terracotta room first.', '请先退出当前陶瓦房间。', '請先退出當前陶瓦房間。'],
  ['Terracotta room is not ready.', '陶瓦房间尚未就绪。', '陶瓦房間尚未就緒。'],
  ['Join a Terracotta room first.', '请先加入陶瓦房间。', '請先加入陶瓦房間。'],
  ['Enter a Terracotta room code.', '请输入陶瓦房间码。', '請輸入陶瓦房間碼。'],
  [
    'Use a Terracotta U/XXXX-XXXX-XXXX-XXXX room code.',
    '请使用 U/XXXX-XXXX-XXXX-XXXX 格式的陶瓦房间码。',
    '請使用 U/XXXX-XXXX-XXXX-XXXX 格式的陶瓦房間碼。',
  ],
  [
    'Download the official Terracotta installer first.',
    '请先下载陶瓦官方安装包。',
    '請先下載陶瓦官方安裝套件。',
  ],
  ['Invalid Minecraft language', 'Minecraft 语言无效', 'Minecraft 語言無效'],
  [
    'Choose an absolute Minecraft directory.',
    '请选择绝对路径的 Minecraft 目录。',
    '請選擇絕對路徑的 Minecraft 目錄。',
  ],
  [
    'Choose an absolute instances directory.',
    '请选择绝对路径的实例目录。',
    '請選擇絕對路徑的實例目錄。',
  ],
  ['Instance metadata exceeds 8 MB.', '实例元数据超过 8 MB。', '實例中繼資料超過 8 MB。'],
  ['Instance settings exceed 1 MB.', '实例设置文件超过 1 MB。', '實例設定檔案超過 1 MB。'],
  [
    'Circular or excessively deep version inheritance.',
    '版本继承存在循环或层数过多。',
    '版本繼承存在循環或層數過多。',
  ],
  ['Missing version profile:', '缺少版本配置：', '缺少版本設定：'],
  [
    'Version profile ID does not match its folder:',
    '版本配置 ID 与目录名称不一致：',
    '版本設定 ID 與目錄名稱不一致：',
  ],
  ['Unsupported MultiMC component:', '不支持的 MultiMC 组件：', '不支援的 MultiMC 元件：'],
  [
    'Legacy jar mods require a compatible launcher.',
    '旧式 Jar 模组需要使用兼容的启动器。',
    '舊式 Jar 模組需要使用相容的啟動器。',
  ],
  ['Invalid instance patch list.', '实例补丁列表无效。', '實例補丁清單無效。'],
  [
    'Unsupported nested instance patch.',
    '不支持嵌套或单独继承的实例补丁。',
    '不支援嵌套或單獨繼承的實例補丁。',
  ],
  ['Invalid MultiMC component list.', 'MultiMC 组件列表无效。', 'MultiMC 元件清單無效。'],
  [
    'MultiMC instance has no Minecraft version.',
    'MultiMC 实例缺少 Minecraft 版本。',
    'MultiMC 實例缺少 Minecraft 版本。',
  ],
  [
    'Multiple mod loaders are not supported in one instance.',
    '不支持单个实例同时使用多个加载器。',
    '不支援單個實例同時使用多個載入器。',
  ],
  ['This instance is already registered.', '此实例已在列表中。', '此實例已在清單中。'],
  [
    'Cannot copy an instance inside itself.',
    '不能将实例复制到其自身目录内。',
    '不能將實例複製到其自身目錄內。',
  ],
  [
    'Cannot move an instance inside itself.',
    '不能将实例移动到其自身目录内。',
    '不能將實例移動到其自身目錄內。',
  ],
  [
    'Select a Minecraft folder or a ZIP instance export.',
    '请选择 Minecraft 目录或 ZIP 实例导出文件。',
    '請選擇 Minecraft 目錄或 ZIP 實例匯出檔案。',
  ],
  [
    'Extract archives larger than 512 MB before importing.',
    '请先解压大于 512 MB 的压缩包，再选择目录导入。',
    '請先解壓大於 512 MB 的壓縮包，再選擇目錄匯入。',
  ],
  ['Scan the source directory first.', '请先扫描来源目录。', '請先掃描來源目錄。'],
  [
    'Instance was not found in the scan.',
    '未在扫描结果中找到该实例。',
    '未在掃描結果中找到該實例。',
  ],
  ['ZIP instances must be copied.', 'ZIP 实例必须使用复制导入。', 'ZIP 實例必須使用複製匯入。'],
  [
    'The source changed. Scan it again.',
    '来源内容已变化，请重新扫描。',
    '來源內容已變化，請重新掃描。',
  ],
  ['An instance import is already in progress.', '实例导入正在进行。', '實例匯入正在進行。'],
  ['Invalid import mode.', '导入方式无效。', '匯入方式無效。'],
  [
    'Runtime files cannot contain symbolic links.',
    '运行文件不能包含符号链接。',
    '執行檔案不能包含符號連結。',
  ],
  [
    'Symbolic links cannot be copied. Use in-place management for linked folders.',
    '无法复制符号链接，请对这类目录选择原地管理。',
    '無法複製符號連結，請對這類目錄選擇原地管理。',
  ],
  [
    'No Java Edition worlds found (level.dat is required).',
    '未找到 Java 版世界存档（缺少 level.dat）。',
    '未找到 Java 版世界存檔（缺少 level.dat）。',
  ],
  [
    'Worlds cannot contain symbolic links.',
    '世界存档不能包含符号链接。',
    '世界存檔不能包含符號連結。',
  ],
  [
    'Select a Java Edition world folder or ZIP.',
    '请选择 Java 版世界存档目录或 ZIP 文件。',
    '請選擇 Java 版世界存檔目錄或 ZIP 檔案。',
  ],
  [
    'World exceeds 512 MB. Copy its folder instead of exporting a ZIP.',
    '世界存档超过 512 MB，请直接复制其目录。',
    '世界存檔超過 512 MB，請直接複製其目錄。',
  ],
  [
    'Instance exceeds 512 MB. Copy its folder instead of exporting a ZIP.',
    '实例超过 512 MB，请直接复制其实例目录。',
    '實例超過 512 MB，請直接複製其實例目錄。',
  ],
  [
    'Authentication profile changed. Sign in again.',
    '认证角色发生变化，请重新登录。',
    '驗證角色發生變化，請重新登入。',
  ],
  ['Authentication profile changed.', '认证角色发生变化。', '驗證角色發生變化。'],
  ['Invalid authentication response.', '认证服务器响应无效。', '驗證伺服器回應無效。'],
  [
    'Invalid authlib-injector artifact metadata.',
    'authlib-injector 下载信息无效。',
    'authlib-injector 下載資訊無效。',
  ],
  [
    'Invalid authlib-injector checksum.',
    'authlib-injector 校验失败。',
    'authlib-injector 驗證失敗。',
  ],
  [
    'Too many authentication server redirects.',
    '认证服务器重定向次数过多。',
    '驗證伺服器重定向次數過多。',
  ],
  ['Enter an account and password.', '请输入账户和密码。', '請輸入帳戶和密碼。'],
  [
    'Invalid stored credentials. Sign in again.',
    '保存的登录凭据无效，请重新登录。',
    '儲存的登入驗證資訊無效，請重新登入。',
  ],
  ['Unknown server software', '未知服务端类型', '未知伺服器類型'],
  ['Server version not found', '未找到服务端版本', '未找到伺服器版本'],
  ['Server build not found', '未找到服务端构建', '未找到伺服器建置'],
  ['Invalid server settings', '服务端设置无效', '伺服器設定無效'],
  ['Invalid server name', '服务端名称无效', '伺服器名稱無效'],
  ['Invalid server properties', '服务端属性无效', '伺服器屬性無效'],
  ['Invalid server property', '服务端属性无效', '伺服器屬性無效'],
  ['Invalid Java path', 'Java 路径无效', 'Java 路徑無效'],
  ['Invalid debug port', '调试端口无效', '偵錯連接埠無效'],
  ['Invalid Gradle arguments', 'Gradle 参数无效', 'Gradle 引數無效'],
  ['Invalid project settings', '项目设置无效', '項目設定無效'],
  ['Absolute project directory required', '请选择项目的绝对路径', '請選擇項目的絕對路徑'],
  ['Choose an absolute server directory.', '请选择服务端的绝对路径。', '請選擇伺服器的絕對路徑。'],
  ['Server JAR exceeds 512 MB.', '服务端 JAR 超过 512 MB。', '伺服器 JAR 超過 512 MB。'],
  ['Select an executable server JAR.', '请选择可执行的服务端 JAR。', '請選擇可執行的伺服器 JAR。'],
  ['This server is already registered.', '此服务端已导入。', '此伺服器已匯入。'],
  [
    'Enter a server name and Minecraft version.',
    '请输入服务端名称和 Minecraft 版本。',
    '請輸入伺服器名稱和 Minecraft 版本。',
  ],
  [
    'No executable server JAR or Forge argument file was found.',
    '未找到可执行的服务端 JAR 或 Forge 参数文件。',
    '未找到可執行的伺服器 JAR 或 Forge 引數檔案。',
  ],
  [
    'Select a server JAR or keep the detected Forge/NeoForge software.',
    '请选择服务端 JAR，或保留识别出的 Forge / NeoForge 类型。',
    '請選擇伺服器 JAR，或保留識別出的 Forge / NeoForge 類型。',
  ],
  ['Invalid Java version', 'Java 版本无效', 'Java 版本無效'],
  ['Invalid JVM arguments', 'JVM 参数无效', 'JVM 引數無效'],
  ['Reserved world folder', '存档目录名称被保留', '存檔目錄名稱被保留'],
  ['Invalid world folder', '存档目录无效', '存檔目錄無效'],
  [
    'Minimum memory exceeds maximum memory',
    '最小内存不能大于最大内存',
    '最小記憶體不能大於最大記憶體',
  ],
  ['Server directory must be absolute', '服务端目录必须为绝对路径', '伺服器目錄必須為絕對路徑'],
  ['Unsupported server content type', '此服务端不支持该内容类型', '此伺服器不支援該內容類型'],
  ['Select a plugin server first', '请先选择插件服务端', '請先選擇擴充套件伺服器'],
  ['No compatible server builds', '没有兼容的服务端构建', '沒有相容的伺服器建置'],
  ['No server worlds found', '未找到服务端存档', '未找到伺服器存檔'],
  ['Backup not found', '备份不存在', '備份不存在'],
  ['Invalid server backup', '服务端备份无效', '伺服器備份無效'],
  ['Enter a single server command', '请输入单条服务端指令', '請輸入單條伺服器指令'],
  ['Install or repair the server first', '请先安装或修复服务端', '請先安裝或修復伺服器'],
  ['JAR has no Main-Class', 'JAR 未声明启动类', 'JAR 未聲明啟動類'],
  [
    'Download cache is busy; retry the task',
    '下载缓存正被使用，请重试任务',
    '下載快取正被使用，請重試工作',
  ],
  ['Segmented download checksum mismatch', '分段下载校验失败', '分段下載驗證失敗'],
  ['Invalid network configuration', '网络设置无效', '網路設定無效'],
  ['Incomplete download segment', '下载分段不完整', '下載分段不完整'],
  [
    'This Minecraft version has no dedicated server download',
    '此 Minecraft 版本没有独立服务端下载',
    '此 Minecraft 版本沒有獨立伺服器下載',
  ],
  ['Invalid download checksum', '下载校验和无效', '下載總和檢查碼無效'],
  ['Unsupported download checksum', '不支持此下载校验算法', '不支援此下載驗證算法'],
  ['Invalid setting value', '设置值无效', '設定值無效'],
  ['Unknown setting', '未知设置', '未知設定'],
  ['Invalid sources', '下载源设置无效', '下載源設定無效'],
  ['Invalid source URL', '下载源地址无效', '下載源位址無效'],
  ['Invalid proxy URL', '代理地址无效', 'Proxy 位址無效'],
  ['Download checksum or size mismatch', '下载校验或文件大小不匹配', '下載驗證或檔案大小不匹配'],
  ['Use SOCKS5 or SOCKS5h', '请使用 SOCKS5 或 SOCKS5h', '請使用 SOCKS5 或 SOCKS5h'],
  [
    'Invalid range; restarting download',
    '下载范围无效，正在重新下载',
    '下載範圍無效，正在重新下載',
  ],
  ['Invalid Content-Range', '服务器返回的下载范围无效', '伺服器返回的下載範圍無效'],
  ['Invalid relative path', '相对路径无效', '相對路徑無效'],
  ['Path escapes directory', '路径超出了允许目录', '路徑超出了允許目錄'],
  ['Invalid filename', '文件名无效', '檔案名無效'],
  [
    'Symbolic links are not allowed in managed paths',
    '管理目录内不允许符号链接',
    '管理目錄內不允許符號連結',
  ],
  ['Archive contains a symbolic link', '压缩包包含符号链接', '壓縮包包含符號連結'],
  ['Archive exceeds extraction limit', '压缩包超过解压大小限制', '壓縮包超過解壓大小限制'],
  ['Unsupported state schema', '状态文件版本不受支持', '狀態檔案版本不受支援'],
  ['Account identity changed', '账户身份发生变化，请重新登录', '帳戶身份發生變化，請重新登入'],
  ['Invalid content file', '内容文件无效', '內容檔案無效'],
  ['Target filename already exists', '目标文件名已存在', '目標檔案名已存在'],
  ['Not a Modrinth modpack', '该文件不是 Modrinth 整合包', '該檔案不是 Modrinth 整合包'],
  ['Unsupported modpack format', '整合包格式不受支持', '整合包格式不受支援'],
  [
    'Modpack has no Minecraft version',
    '整合包未指定 Minecraft 版本',
    '整合包未指定 Minecraft 版本',
  ],
  ['Reserved modpack path', '整合包使用了保留路径', '整合包使用了保留路徑'],
  [
    'Reserved modpack override path',
    '整合包覆盖文件使用了保留路径',
    '整合包覆蓋檔案使用了保留路徑',
  ],
  [
    'Modpack file has no hash or URL',
    '整合包文件缺少哈希或下载地址',
    '整合包檔案缺少雜湊或下載位址',
  ],
  ['Modpack URLs must use HTTPS', '整合包下载地址必须使用 HTTPS', '整合包下載位址必須使用 HTTPS'],
  ['Modpack index exceeds size limit', '整合包索引超过大小限制', '整合包索引超過大小限制'],
  ['Template contains a symbolic link', '项目模板包含符号链接', '項目範本包含符號連結'],
  ['Gradle wrapper not found', '未找到 Gradle Wrapper', '未找到 Gradle Wrapper'],
  ['Cannot determine Java version', '无法确定 Java 版本', '無法確定 Java 版本'],
  ['Unsupported JDK platform', '当前平台没有适配的 JDK', '當前平臺沒有適配的 JDK'],
  ['No matching JDK found', '未找到适配的 JDK', '未找到適配的 JDK'],
  [
    'This JDK already exists. Detect local Java to use it.',
    '该 JDK 已存在，请检测本地 Java 后使用。',
    '該 JDK 已存在，請偵測本機 Java 後使用。',
  ],
  ['Invalid version manifest', 'Minecraft 版本清单无效', 'Minecraft 版本清單無效'],
  ['Minecraft version not found', '未找到 Minecraft 版本', '未找到 Minecraft 版本'],
  ['No compatible loader version', '未找到兼容的加载器版本', '未找到相容的載入器版本'],
  ['No download URL', '没有可用下载地址', '沒有可用下載位址'],
  ['Download sources must use HTTPS', '下载源必须使用 HTTPS', '下載源必須使用 HTTPS'],
  [
    'World backups cannot contain symbolic links',
    '存档备份不能包含符号链接',
    '存檔備份不能包含符號連結',
  ],
  ['No saves found', '未找到存档', '未找到存檔'],
  ['Cannot move a directory inside itself', '不能将目录移动到其子目录', '不能將目錄移動到其子目錄'],
  ['Destination already exists', '目标目录已存在', '目標目錄已存在'],
  ['Absolute directory path required', '请填写绝对目录路径', '請填寫絕對目錄路徑'],
  ['State file is busy', '状态文件正被其他窗口使用', '狀態檔案正被其他視窗使用'],
  ['Invalid state file', '状态文件内容无效', '狀態檔案內容無效'],
  ['Account was removed', '账户已被移除', '帳戶已被移除'],
  ['Invalid instance settings', '实例设置无效', '實例設定無效'],
  ['Invalid instance name', '实例名称无效', '實例名稱無效'],
  ['Invalid memory limit', '内存限制无效', '記憶體限制無效'],
  ['Invalid garbage collector', '垃圾回收器无效', '記憶體回收器無效'],
  ['Invalid window resolution', '窗口尺寸无效', '視窗尺寸無效'],
  ['Invalid server address', '服务器地址无效', '伺服器位址無效'],
  ['Invalid backup preference', '备份设置无效', '備份設定無效'],
  ['Arguments must be an array of strings', '参数必须是字符串数组', '引數必須是字串陣列'],
  ['Account not found', '账户不存在', '帳戶不存在'],
  ['Content file not found', '内容文件不存在', '內容檔案不存在'],
  ['Only HTTPS links are allowed', '仅支持 HTTPS 链接', '僅支援 HTTPS 連結'],
  [
    'Local pack overrides exceed 1 GB',
    '整合包本地覆盖文件超过 1 GB',
    '整合包本機覆蓋檔案超過 1 GB',
  ],
];
export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401)
      return t(
        'Authentication expired or was rejected. Sign in again.',
        '认证已过期或被拒绝，请重新登录。',
        '驗證已過期或被拒絕，請重新登入。',
      );
    if (error.status === 403)
      return t(
        'Access denied (HTTP 403). For Microsoft sign-in, check your application Client ID and Minecraft Services approval.',
        '访问被拒绝（HTTP 403）。若在 Microsoft 登录时发生，请检查 Client ID 和 Minecraft Services 访问许可。',
        '存取被拒絕（HTTP 403）。若在 Microsoft 登入時發生，請檢查 Client ID 和 Minecraft Services 存取授權。',
      );
    if (error.status === 429)
      return t(
        'Too many requests. Wait a moment and retry.',
        '请求过于频繁，请稍后重试。',
        '請求過於頻繁，請稍後重試。',
      );
    if (error.status === 400) {
      let code = '';
      try {
        code = JSON.parse(error.body).error;
      } catch {}
      if (code === 'invalid_grant' || code === 'expired_token')
        return t(
          'Sign-in expired. Sign in again.',
          '登录已过期，请重新登录。',
          '登入已過期，請重新登入。',
        );
      if (code === 'authorization_declined' || code === 'access_denied')
        return t('Sign-in was declined.', '登录被拒绝。', '登入被拒絕。');
      if (code === 'invalid_client' || code === 'unauthorized_client')
        return t(
          'The Microsoft Client ID is invalid or device sign-in is not enabled.',
          'Microsoft Client ID 无效，或未启用设备代码登录。',
          'Microsoft Client ID 無效，或未啟用設備程式碼登入。',
        );
    }
  }
  let message = redact(error instanceof Error ? error.message : String(error));
  for (const [en, zh, zhTw] of messages) message = message.split(en).join(t(en, zh, zhTw));
  message = message.replace(
    /Java (\d+) required\. Use Java → Download JDK or configure a Java executable\./,
    (_, version) =>
      t(
        `Java ${version} required. Use Java → Download JDK or configure a Java executable.`,
        `需要 Java ${version}。请使用 Java → 下载 JDK，或配置 Java 可执行文件。`,
        `需要 Java ${version}。請使用 Java → 下載 JDK，或設定 Java 執行檔。`,
      ),
  );
  return message;
}
export function diagnosticError(error: unknown): string {
  const details: string[] = [];
  const seen = new Set<unknown>();
  for (
    let current = error;
    current instanceof Error && !seen.has(current) && details.length < 4;
    current = current.cause
  ) {
    seen.add(current);
    details.push(current.stack || `${current.name}: ${current.message}`);
  }
  return redact(details.length ? details.join('\nCaused by: ') : String(error));
}
