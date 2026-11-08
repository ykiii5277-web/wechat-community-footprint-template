const https = require('https');
const MAX_FILE_BYTES = 1000 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 500 * 1024 * 1024;
function isImage(item) { return /\.(jpe?g|png|gif|webp|bmp|heic|heif|avif)(?:\?|$)/i.test(item.fileName || item.filePath || '') || /^(jpe?g|png|gif|webp|bmp|heic|heif|avif)$/i.test(item.fileType || ''); }
function fileLimit(kind, item) { return kind === 'photo' || isImage(item) ? MAX_IMAGE_BYTES : isVideo(item) ? MAX_VIDEO_BYTES : MAX_FILE_BYTES; }
function isVideo(item) {
  return item.mediaType === 'video' || /^(mp4|mov|m4v|webm|3gp|avi|mkv|flv|wmv|mpeg|mpg|ts)$/i.test(item.fileType || '') || /\.(mp4|mov|m4v|webm|3gp|avi|mkv|flv|wmv|mpeg|mpg|ts)$/i.test(item.fileName || '');
}
async function storedFileSize(cloud, fileID) {
  const response = await cloud.getTempFileURL({ fileList: [fileID] });
  const file = (response.fileList || []).find(item => item.fileID === fileID);
  if (!file || !/^https:\/\//i.test(file.tempFileURL || '')) throw new Error('FILE_SIZE_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    // 临时链接通常按 GET 签名。只请求一个字节，避免用 HEAD 触发签名不匹配，也不下载整个视频。
    const request = https.request(file.tempFileURL, { method: 'GET', headers: { Range: 'bytes=0-0' } }, res => {
      const range = String(res.headers['content-range'] || '').match(/\/(\d+)$/);
      const size = Number(range ? range[1] : res.headers['content-length']);
      res.destroy();
      if (![200, 206].includes(res.statusCode) || !Number.isSafeInteger(size) || size <= 0) return reject(new Error('FILE_SIZE_UNAVAILABLE'));
      resolve(size);
    });
    request.setTimeout(10000, () => request.destroy(new Error('FILE_SIZE_UNAVAILABLE')));
    request.on('error', () => reject(new Error('FILE_SIZE_UNAVAILABLE')));
    request.end();
  });
}
module.exports = { MAX_FILE_BYTES, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, fileLimit, isImage, isVideo, storedFileSize };
