export function convertSrtToVtt(srtText) {
  // WEBVTT header
  let vtt = 'WEBVTT\n\n';
  
  // Replace comma decimal separators in timestamps with dot decimal separators
  // Matches: HH:MM:SS,mmm --> HH:MM:SS,mmm
  const timestampRegex = /(\d{2}:\d{2}:\d{2}),(\d{3})/g;
  vtt += srtText.replace(timestampRegex, '$1.$2');
  
  return vtt;
}

export function convertAssToVtt(assText) {
  const lines = assText.split(/\r?\n/);
  let vtt = 'WEBVTT\n\n';
  let counter = 1;
  
  for (const line of lines) {
    if (line.startsWith('Dialogue:')) {
      // Format: Dialogue: Marked, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
      // Example: Dialogue: 0,0:01:20.00,0:01:23.00,Default,,0,0,0,,Hello world
      const parts = line.split(',');
      if (parts.length >= 10) {
        const start = parts[1].trim(); 
        const end = parts[2].trim();   
        
        // Convert H:MM:SS.CC to HH:MM:SS.CC0 (WebVTT standard)
        const formatTime = (t) => {
          const match = t.match(/^(\d):(\d{2}):(\d{2})\.(\d{2})$/);
          if (match) {
            return `0${match[1]}:${match[2]}:${match[3]}.${match[4]}0`;
          }
          return t;
        };

        const startTime = formatTime(start);
        const endTime = formatTime(end);
        
        // Join back text parts in case there were commas inside the subtitle text
        let text = parts.slice(9).join(',');
        
        // Strip out SSA/ASS formatting overrides, e.g., {\an8}, {\pos(100,200)}
        text = text.replace(/\{[^}]+\}/g, '');
        
        // Replace \N (ASS newline) with regular newline
        text = text.replace(/\\N/g, '\n');
        
        // Remove trailing carriage returns
        text = text.trim();

        if (text) {
          vtt += `${counter}\n${startTime} --> ${endTime}\n${text}\n\n`;
          counter++;
        }
      }
    }
  }
  
  return vtt;
}

export function convertToVtt(buffer, originalExtension) {
  const content = buffer.toString('utf8');
  const ext = originalExtension.toLowerCase();
  
  if (ext === '.srt') {
    return convertSrtToVtt(content);
  } else if (ext === '.ass') {
    return convertAssToVtt(content);
  } else if (ext === '.vtt') {
    return content;
  }
  
  throw new Error(`Unsupported subtitle format: ${originalExtension}`);
}
