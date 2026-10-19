import type { NormalizedProject } from '../adapters/types.ts';
import type { MatchResult } from './matcher.ts';

function isArabic(text: string): boolean {
  return /[\u0600-\u06FF]/.test(text);
}

/**
 * Builds a prompt for OpenAI / Gemini to generate a winning proposal.
 */
function buildPrompt(project: NormalizedProject, match: MatchResult, lang: 'ar' | 'en'): string {
  const matchedKeywords = [
    ...match.strongMatches,
    ...match.mediumMatches,
    ...match.weakMatches,
  ].join(', ');

  const title = project.title || '';
  const desc = (project.description || project.listingDescription || '').slice(0, 1000);

  if (lang === 'ar') {
    return `أنت مروان مصطفى (Marwan Mostafa)، مهندس برمجيات ومستقل محترف متخصص في حلول الذكاء الاصطناعي (LLM, LangChain, RAG)، أتمتة العمليات (n8n, Make)، الشات بوت (WhatsApp API, Telegram)، تطوير بايثون (Python, FastAPI, Web Scraping)، وتعلّم الآلة.

اكتب عرض عمل (Bid Proposal) احترافي ومقنع للعميل على مشروع العمل الحر التالي:
عنوان المشروع: ${title}
تفاصيل المشروع: ${desc}
المهارات المطلوبة المتطابقة: ${matchedKeywords || 'البرمجة والأتمتة'}

الشروط الإلزامية:
1. اكتب باللغة العربية الفصحى الاحترافية.
2. لا تستخدم مقدمات تقليدية مثل "يسعدني التقدم لمشروعك" أو "أتمنى أن تكون بخير". ابدأ بجملة افتتاحية قوية ترتبط بهدف المشروع ومشاكله مباشرة.
3. وضّح خبرتك المباشرة في المجال وقدم خطوات عمل واضحة وعملية (2 إلى 3 خطوات).
4. اختم بدعوة تواصل واثقة ومباشرة لمناقشة التفاصيل.
5. لا تضع أي أقواس أو نصوص نائبة مثل [اسمك] أو [الميزانية]، واكتب نص العرض جاهزاً للإرسال مباشرة في حدود 80 إلى 120 كلمة.`;
  }

  return `You are Marwan Mostafa, an expert software engineer and freelancer specializing in AI solutions (LLM, LangChain, RAG), Workflow Automation (n8n, Make), Chatbots (WhatsApp API, Telegram), Python development (FastAPI, Web Scraping), and Machine Learning.

Write a compelling, winning freelance bid proposal for this project:
Project Title: ${title}
Project Description: ${desc}
Matching Skills: ${matchedKeywords || 'Automation & Software Development'}

Mandatory Guidelines:
1. Write in clear, professional English.
2. Do NOT use generic opening cliches like "I hope this finds you well" or "I am excited to submit my proposal". Start with a strong hook directly addressing the client's specific goal.
3. Highlight relevant expertise and provide a concise 2-3 step execution approach.
4. End with a confident, brief call to action inviting them to chat.
5. Do NOT include placeholders like [Your Name] or [Price/Timeline]. Output ONLY the finished, ready-to-paste proposal (80 to 120 words).`;
}

/**
 * Calls OpenAI API if OPENAI_API_KEY is configured.
 */
async function callOpenAI(prompt: string, apiKey: string): Promise<string> {
  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: 'You write high-converting, professional, tailored freelance proposals directly without filler.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 350,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OpenAI API error ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('OpenAI returned empty message content');
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls Google Gemini API if GEMINI_API_KEY is configured.
 */
async function callGemini(prompt: string, apiKey: string): Promise<string> {
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 9000);

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 350,
        },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const data: any = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!content) throw new Error('Gemini returned empty message content');
    return content;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback smart template when no AI API key is configured or when API call fails.
 * Produces clean, tailored proposals in Arabic or English.
 */
export function generateSmartTemplate(project: NormalizedProject, match: MatchResult): string {
  const textToCheck = `${project.title || ''} ${project.description || ''}`;
  const lang = isArabic(textToCheck) ? 'ar' : 'en';

  const skillList = [
    ...match.strongMatches,
    ...match.mediumMatches,
    ...match.weakMatches,
  ];

  const primarySkill = skillList[0] || (lang === 'ar' ? 'البرمجة والأتمتة' : 'Software & Automation');
  const cleanTitle = (project.title || '').replace(/\s+/g, ' ').trim();

  if (lang === 'ar') {
    return `السلام عليكم ورحمة الله،
قرأت تفاصيل مشروعكم بخصوص "${cleanTitle}"، ولدي خبرة متخصصة ومشاريع سابقة منفذة في ${primarySkill} والحلول البرمجية المشابهة.

خطتي لتنفيذ المشروع بأعلى كفاءة:
1. مراجعة المتطلبات الدقيقة وتحديد الهيكلية التقنية الأنسب لضمان الاستقرار.
2. بناء وتطوير الحل واختباره بدقة عبر سيناريوهات استخدام واقعية.
3. تسليم العمل مع شرح وافٍ وتقديم الدعم الفني اللازم بعد التسليم.

جاهز لمناقشة التفاصيل والبدء في التنفيذ مباشرة. يسعدني تواصلكم معي.`;
  }

  return `Hi there,
I reviewed your project regarding "${cleanTitle}". With hands-on experience in ${primarySkill} and similar technical implementations, I can deliver a clean, reliable, and high-performance solution.

My approach:
1. Clarify workflow specifics and establish the optimal technical setup.
2. Develop, test, and validate the solution against edge cases.
3. Deliver full source code/configuration with deployment guidance and support.

I am ready to get started immediately. Feel free to send a message so we can discuss the details!`;
}

/**
 * Generates an AI bid proposal using OpenAI, Gemini, or smart fallback.
 */
export async function generateProposal(
  project: NormalizedProject,
  match: MatchResult,
): Promise<string> {
  const textToCheck = `${project.title || ''} ${project.description || ''}`;
  const lang = isArabic(textToCheck) ? 'ar' : 'en';

  // 1. Try OpenAI if configured
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  if (openaiKey) {
    try {
      const prompt = buildPrompt(project, match, lang);
      return await callOpenAI(prompt, openaiKey);
    } catch (err: any) {
      console.warn(`[AI Bid] OpenAI failed (${err.message}), falling back...`);
    }
  }

  // 2. Try Gemini if configured
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (geminiKey) {
    try {
      const prompt = buildPrompt(project, match, lang);
      return await callGemini(prompt, geminiKey);
    } catch (err: any) {
      console.warn(`[AI Bid] Gemini failed (${err.message}), falling back...`);
    }
  }

  // 3. Fallback to smart template
  return generateSmartTemplate(project, match);
}
