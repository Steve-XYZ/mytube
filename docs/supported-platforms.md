# MyTube Supported Platforms

MyTube should be positioned as a browser with download tools for supported,
publicly available media. It must not be marketed as a universal downloader or
as a way to bypass DRM, paid access, login walls, platform controls, or rights
holder restrictions.

## Support Levels

| Level | Meaning |
| --- | --- |
| Supported | The URL pattern is recognized, `yt-dlp` can be attempted, and MyTube should show a clear download flow or clear error. |
| Best effort | The page may expose direct media requests that MyTube can capture, but success depends on the site and session. |
| Blocked | MyTube should not try to bypass the restriction. Show a clear user-facing limitation. |

## Current Matrix

| Platform | Level | Entry points |
| --- | --- | --- |
| YouTube | Supported with limitations | Videos, Shorts, live URLs. Some anonymous sessions can still be rejected upstream. |
| Instagram | Supported with limitations | Posts, reels, stories, and video pages. Browsing/profile pages are not downloadable entries. |
| TikTok | Supported with limitations | Specific video URLs. |
| Facebook | Supported with limitations | Watch, reels, `fb.watch`, and explicit video URLs. |
| X / Twitter | Supported with limitations | Status URLs. |
| Reddit | Supported with limitations | Specific post/comment URLs. |
| Vimeo | Supported | Specific video URLs. |
| Dailymotion | Supported | Specific `/video/` URLs. |
| Twitch | Supported with limitations | VOD and clip URLs. |
| Rumble | Supported | Specific video URLs. |
| Bilibili | Supported with limitations | Specific video URLs. |
| Odysee | Supported | Channel media URLs. |
| SoundCloud | Supported | Track-like URLs. |
| Bandcamp | Supported | Track URLs. |
| Direct media | Supported | Direct MP4, WebM, MOV, MKV, MP3, M4A, WAV, FLAC, HLS, or DASH URLs. |
| Unknown pages with media requests | Best effort | Captured media requests from the active browser tab. |
| DRM, paid access, private media, or access controls | Blocked | Do not bypass. Show a clear limitation. |

## Product Rules

- Keep platform claims tied to tested URL patterns.
- Prefer "supported with limitations" when upstream login, anti-bot, or session behavior can affect results.
- Do not claim YouTube downloads always work.
- Do not bypass DRM or paid/private access.
- Keep sensitive headers out of generic downloader logs and UI errors.
- When adding a platform, add URL-classifier coverage and at least one mocked or pure unit test.
