import { t } from './config';
import { redact } from './files';
import { HttpError } from './network';

const messages: [string, string][] = [
  ['Unknown server software', '未知服务端类型'],
  ['Server version not found', '未找到服务端版本'],
  ['Server build not found', '未找到服务端构建'],
  ['Invalid server settings', '服务端设置无效'],
  ['Invalid server name', '服务端名称无效'],
  ['Invalid server properties', '服务端属性无效'],
  ['Invalid server property', '服务端属性无效'],
  ['Invalid Java path', 'Java 路径无效'],
  ['Invalid Java version', 'Java 版本无效'],
  ['Invalid JVM arguments', 'JVM 参数无效'],
  ['Reserved world folder', '存档目录名称被保留'],
  ['Invalid world folder', '存档目录无效'],
  ['Minimum memory exceeds maximum memory', '最小内存不能大于最大内存'],
  ['Server directory must be absolute', '服务端目录必须为绝对路径'],
  ['Unsupported server content type', '此服务端不支持该内容类型'],
  ['Select a plugin server first', '请先选择插件服务端'],
  ['No compatible server builds', '没有兼容的服务端构建'],
  ['No server worlds found', '未找到服务端存档'],
  ['Backup not found', '备份不存在'],
  ['Invalid server backup', '服务端备份无效'],
  ['Enter a single server command', '请输入单条服务端指令'],
  ['Install or repair the server first', '请先安装或修复服务端'],
  ['JAR has no Main-Class', 'JAR 未声明启动类'],
  ['Download cache is busy; retry the task', '下载缓存正被使用，请重试任务'],
  ['Segmented download checksum mismatch', '分段下载校验失败'],
  ['Invalid network configuration', '网络设置无效'],
  ['Incomplete download segment', '下载分段不完整'],
  [
    'This Minecraft version has no dedicated server download',
    '此 Minecraft 版本没有独立服务端下载',
  ],
  ['Invalid download checksum', '下载校验和无效'],
  ['Unsupported download checksum', '不支持此下载校验算法'],
  ['Invalid setting value', '设置值无效'],
  ['Unknown setting', '未知设置'],
  ['Invalid sources', '下载源设置无效'],
  ['Invalid source URL', '下载源地址无效'],
  ['Invalid proxy URL', '代理地址无效'],
  ['Download checksum or size mismatch', '下载校验或文件大小不匹配'],
  ['Use SOCKS5 or SOCKS5h', '请使用 SOCKS5 或 SOCKS5h'],
  ['Invalid range; restarting download', '下载范围无效，正在重新下载'],
  ['Invalid Content-Range', '服务器返回的下载范围无效'],
  ['Invalid relative path', '相对路径无效'],
  ['Path escapes directory', '路径超出了允许目录'],
  ['Invalid filename', '文件名无效'],
  ['Symbolic links are not allowed in managed paths', '管理目录内不允许符号链接'],
  ['Archive contains a symbolic link', '压缩包包含符号链接'],
  ['Archive exceeds extraction limit', '压缩包超过解压大小限制'],
  ['Unsupported state schema', '状态文件版本不受支持'],
  ['Account identity changed', '账户身份发生变化，请重新登录'],
  ['Invalid content file', '内容文件无效'],
  ['Target filename already exists', '目标文件名已存在'],
  ['Not a Modrinth modpack', '该文件不是 Modrinth 整合包'],
  ['Unsupported modpack format', '整合包格式不受支持'],
  ['Modpack has no Minecraft version', '整合包未指定 Minecraft 版本'],
  ['Reserved modpack path', '整合包使用了保留路径'],
  ['Reserved modpack override path', '整合包覆盖文件使用了保留路径'],
  ['Modpack file has no hash or URL', '整合包文件缺少哈希或下载地址'],
  ['Modpack URLs must use HTTPS', '整合包下载地址必须使用 HTTPS'],
  ['Modpack index exceeds size limit', '整合包索引超过大小限制'],
  ['Template contains a symbolic link', '项目模板包含符号链接'],
  ['Gradle wrapper not found', '未找到 Gradle Wrapper'],
  ['Cannot determine Java version', '无法确定 Java 版本'],
  ['Unsupported JDK platform', '当前平台没有适配的 JDK'],
  ['No matching JDK found', '未找到适配的 JDK'],
  [
    'This JDK already exists. Detect local Java to use it.',
    '该 JDK 已存在，请检测本地 Java 后使用。',
  ],
  ['Invalid version manifest', 'Minecraft 版本清单无效'],
  ['Minecraft version not found', '未找到 Minecraft 版本'],
  ['No compatible loader version', '未找到兼容的加载器版本'],
  ['No download URL', '没有可用下载地址'],
  ['Download sources must use HTTPS', '下载源必须使用 HTTPS'],
  ['World backups cannot contain symbolic links', '存档备份不能包含符号链接'],
  ['No saves found', '未找到存档'],
  ['Cannot move a directory inside itself', '不能将目录移动到其子目录'],
  ['Destination already exists', '目标目录已存在'],
  ['Absolute directory path required', '请填写绝对目录路径'],
  ['State file is busy', '状态文件正被其他窗口使用'],
  ['Invalid state file', '状态文件内容无效'],
  ['Account was removed', '账户已被移除'],
  ['Invalid instance settings', '实例设置无效'],
  ['Invalid instance name', '实例名称无效'],
  ['Invalid memory limit', '内存限制无效'],
  ['Invalid garbage collector', '垃圾回收器无效'],
  ['Invalid window resolution', '窗口尺寸无效'],
  ['Invalid server address', '服务器地址无效'],
  ['Invalid backup preference', '备份设置无效'],
  ['Arguments must be an array of strings', '参数必须是字符串数组'],
  ['Account not found', '账户不存在'],
  ['Content file not found', '内容文件不存在'],
  ['Only HTTPS links are allowed', '仅支持 HTTPS 链接'],
  ['Local pack overrides exceed 1 GB', '整合包本地覆盖文件超过 1 GB'],
];
export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    if (error.status === 401)
      return t(
        'Authentication expired or was rejected. Sign in again.',
        '认证已过期或被拒绝，请重新登录。',
      );
    if (error.status === 403)
      return t(
        'Access denied (HTTP 403). For Microsoft sign-in, check your application Client ID and Minecraft Services approval.',
        '访问被拒绝（HTTP 403）。若在 Microsoft 登录时发生，请检查 Client ID 和 Minecraft Services 访问许可。',
      );
    if (error.status === 429)
      return t('Too many requests. Wait a moment and retry.', '请求过于频繁，请稍后重试。');
    if (error.status === 400) {
      let code = '';
      try {
        code = JSON.parse(error.body).error;
      } catch {}
      if (code === 'invalid_grant' || code === 'expired_token')
        return t('Sign-in expired. Sign in again.', '登录已过期，请重新登录。');
      if (code === 'authorization_declined' || code === 'access_denied')
        return t('Sign-in was declined.', '登录被拒绝。');
      if (code === 'invalid_client' || code === 'unauthorized_client')
        return t(
          'The Microsoft Client ID is invalid or device sign-in is not enabled.',
          'Microsoft Client ID 无效，或未启用设备代码登录。',
        );
    }
  }
  let message = redact(error instanceof Error ? error.message : String(error));
  for (const [en, zh] of messages) message = message.split(en).join(t(en, zh));
  message = message.replace(
    /Java (\d+) required\. Use Java → Download JDK or configure a Java executable\./,
    (_, version) =>
      t(
        `Java ${version} required. Use Java → Download JDK or configure a Java executable.`,
        `需要 Java ${version}。请使用 Java → 下载 JDK，或配置 Java 可执行文件。`,
      ),
  );
  return message;
}
