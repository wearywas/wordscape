# Prompt 1 — exact recorded text

Good evening GPT! OpenAI is running a new dev challenge -- we started one attempt on a different concept, but it glitched out after the second prompt (said the conversation was full on context -- unusual old style glitch to run into) -- shall we take a fresh shot? Here's the Discord thread with all of the details:\
\
"\
1\.&#x20;\
[🟢]\(https\://discord.com/assets/2d6d478121939bde.svg) Starts: now [⏰]\(https\://discord.com/assets/d9505466edba0bff.svg) Deadline: Sunday, November 22, 2026 11:59 PM&#x20;\
&#x20;Build something useful with Codex in 10 prompts or less, then show us how you spent them. &#x20;\
\- Your ten cover the whole project across Codex and ChatGPT, from planning to debugging\
\- Follow-ups, "continue", "fix this" and retries all count, and a new chat doesn't reset your count\
\- Setup and config by hand is fine, writing features or fixing code by hand isn't\
\- Start a new project during the event, one entry per person\
\- Reply in the thread below with your repo or demo, a short description, how you spent your ten, and your build history.\
\- Full rules and how to save your history are in the thread\
\- How useful it is\
\- How well you used your ten\
\- How clear your writeup is\
[🥇]\(https\://discord.com/assets/08b871e132a77f8b.svg) 1st: $500 [🥈]\(https\://discord.com/assets/e60f28f718ca79b5.svg) 2nd: $250 [🥉]\(https\://discord.com/assets/21d7244670423a9b.svg) 3rd: $150&#x20;\
Winners choose OpenAI API credits or Codex credits. There's no prize for finishing fastest. It's all about the quality of what you build, so take your time and spend your ten wisely! :) @Dev Challenges @Builder\
[Image]\(https\://media.discordapp.net/attachments/1450211269570465922/1569641196043898890/TenPromptBuild.png?ex=6af82647&is=6af6d4c7&hm=7e617b94f94396a27f242d9385290bf4f398a41c43f62980720ec2dc46e3d403&format=webp&quality=lossless&width=1024&height=577)\
1\.&#x20;\
\- Your ten cover the whole project across Codex and ChatGPT: planning, building and debugging.\
\- Follow-ups, "continue", "fix this", answers to the agent's questions, manually requested retries and edited-and-resubmitted prompts all count. Starting a new chat doesn't reset your count. Include unsuccessful attempts too.\
\- Codex's automatic tool use, built-in subagent work, automatic connection retries, plain permission approvals, and exporting or sharing your session don't count. Any extra direction you send still counts.\
\- Specs, attachments or instruction files you use to direct the build are part of the prompt you use them in, so include them. Don't add unrecorded instructions through files between prompts.\
\- Brainstorming ideas or having ChatGPT write your prompts counts too. Thinking, sketching or writing prompts yourself is free.\
\- Setup, config values, credentials and small wording edits are fine, just disclose the changes, not the secrets. Writing features or fixing application code by hand isn't.\
\- Start a new project during the event. Standard libraries and starter templates are fine, but disclose what you started with. No older projects or pre-built features presented as event work.\
\- Use only Codex and ChatGPT for AI assistance when planning, building or debugging your entry.\
\- One entry per person.\
\- Don't commit API keys, tokens, secrets or .env files. Remove sensitive or personal info before sharing and clearly mark redactions.\
\- Keep your original sessions and submitted source version until judging is complete. Finalists may be asked to show both privately. Entries we can't verify aren't eligible for prizes.\
\- By entering, you agree that we may feature your project name, description and submitted demo/images in the event showcase and Spotlight. Private verification material won't be published.\
1\.&#x20;\
Reply in this thread before the deadline with:&#x20;\
\- Public GitHub repo, or a demo link / video\
\- Short description: what you built and who it's for\
\- How I spent my ten: every prompt copy-pasted in order, including any supporting instructions, with a one-line note on what each did\
\- Build notes: client/models used, any starting template, custom instructions or skills, and manual changes\
\- Build history for every conversation used on the project (see below)\
\- Codex CLI: run /export session.md after the final turn finishes ([how to]\(https\://learn.chatgpt.com/docs/developer-commands?surface=cli#export-a-conversation-with-export "how to&#xA;&#xA;(https\://learn.chatgpt.com/docs/developer-commands?surface=cli#export-a-conversation-with-export\\)"))\
\- ChatGPT chats: a share link to the full conversation, not just one response\
\- Codex in the ChatGPT desktop app (macOS): a shared snapshot of the completed thread ([how to]\(https\://learn.chatgpt.com/docs/use-chatgpt#share-a-read-only-snapshot-of-a-codex-thread "how to&#xA;&#xA;(https\://learn.chatgpt.com/docs/use-chatgpt#share-a-read-only-snapshot-of-a-codex-thread\\)")). Use a personal account, workspace links only open for your workspace\
\- Sharing/export unavailable: readable screenshots in order, or a screen recording of the full conversation\
&#x20;Include all prompts and responses, not just highlights. Longer logs can go in your repo or a linked doc. Check how you'll save your history before you start, and make sure we can open it. &#x20;\
"\
\
So, can you mark each back-and-forth chat we have numerically (this being the first, of course), and target any finalization or polishing for your 10th full reply to me, making decisions as needed on your end for final wrap-up that wasn't addressed by me in the 9th message from me, or before?\
\
Since we have limited room for iteration, let's try to complete as much of the initial build in your first reply, so we have room to polish and refine as the 10th prompt approaches. Let's set it up as a new private Git repo with standard best practices -- any general decisions along the way there are yours to make the call on.\
\
For this new experimental build there's a concept for rapid world generation I've been kicking around in my head for several years that I've never been able to fully clarify or articulate -- let's see if we can kick it closer: though LLMs have made great strides with 3D, spatial logic has never innately been their strong point -- but words are. I'm wondering what if we combine the two in a novel manner: an isometric map that places world objects with language instead of images, that can then be plugged into different type of generators to translate those world items into 2D or 3D worlds very quickly, replacing the items stated with language as visual placements. In theory, you could then have vast "pop-up" 3D worlds that are compressed to incredibly small sizes since it's just a top-down map or graph populated with text (however you think makes the most sense to store and create the world generations), since the placement of the world is already set -- it just needs to be translated into visuals -- which is the latter half of the equation, which may be easier said than done, but I think large 3D generation workflows are only going to get faster and faster. So, in a sense, it could potentially be a new framework for creating and transferring worlds? In our demo for the translation half we might use ThreeJS, or plug it into the Meshy API (though the latter would be fairly expensive to populate, while with ThreeJS we could just build the 3D objects) -- so maybe ThreeJS with relatively simple visual representation to start. Now, spatial arrangement and placement might still be tricky, and we might still need to have some sort of way of blocking out different quadrants for different sizes of world objects being placed -- while allowing them to overlap, as they would from above in the real world.\
\
To get started, I think before we try to create any new worlds, we should first try replicating the real world into this type of format -- that will help us understand how the real world is structured (and create world generation rules from it over time), while also hammering out this new format or framework for storing worlds as text in an isometric graph or map. To do that, I'm thinking we look at a slice of real-world satellite imagery and translate that to this new format -- using Google Maps, or whatever equivalent is available to you to access. Let's start with however many snapshots at whatever graph/map size and view distance you think is clear enough to determine what objects exist below from that view above. For the framework map/graph  please feel free to be creative and create it however you think would work best for this concept, in whatever format, refining and iterating as you think makes sense.\
\
Please make any creative and technical decisions on your end in this first build during your reply phase -- I'll answer any questions you have at that point from a perspective of refinement or addition in my reply (Prompt #2, technically)!

