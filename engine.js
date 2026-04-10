// engine.js — Toolipedia stack recommendation engine
// Adapted from Index.html — browser globals removed, session passed as parameter

const { TOOLS, TOOL_META, GOAL_WEIGHTS, DEEP_PROFILES, TOOL_COMBOS, IDEA_QUESTIONS, BUILD_QUESTIONS } = require('./data');

function parseGoal(text, session){
  if (!session) session = {};
  const g=text.toLowerCase();
  const t=new Set();
  if(/youtube|channel/.test(g)){t.add('creator');t.add('youtube');t.add('video');}
  if(/\bvideo\b|reel|tiktok|shorts|film/.test(g)){t.add('creator');t.add('video');}
  if(/podcast|audio/.test(g)){t.add('creator');t.add('audio');}
  if(/blog|newsletter|writ.*content|content.*creat|social.*post/.test(g)){t.add('creator');t.add('writing');t.add('content');}
  if(/\bapp\b|saas|mvp|software|build.*product|ship.*product/.test(g)){t.add('developer');t.add('product');}
  if(/code|program|develop|engineer|developer/.test(g)){t.add('developer');t.add('coding');}
  if(/agency|client work|freelanc/.test(g)){t.add('agency');t.add('freelance');}
  if(/market|campaign|seo|ads|brand/.test(g)){t.add('marketer');t.add('content');}
  if(/sales|crm|deal|prospect|revenue/.test(g)){t.add('sales');}
  if(/legal|contract|compliance|law/.test(g)){t.add('legal');}
  if(/research|notes|knowledge|study|learn|reading/.test(g)){t.add('researcher');t.add('knowledge');}
  if(/automat|workflow|pipeline|connect.*tools/.test(g)){t.add('automation');}
  if(/meeting|team.*work|collaborat/.test(g)){t.add('team');t.add('productivity');}
  if(/enterprise|company|organisation|org\b|business/.test(g)){t.add('enterprise');t.add('team');}
  if(/productiv|streamline|efficien/.test(g)){t.add('productivity');}
  if(t.size===0) t.add('general');
  return [...t];
}

function buildDerivedTags(session){
  if (!session) session = {};
  const tags=[...session.goalTags];
  const a=session.answers;
  const isBuild=session.mode==='build';

  if(isBuild){
    // Build mode — derive tags from architecture questions
    tags.push('developer');
    if(a.model_need==='code')   {tags.push('coding');tags.push('developer');}
    if(a.model_need==='voice')  tags.push('audio');
    if(a.model_need==='embed'||a.model_need==='agents') tags.push('automation');
    if(a.model_need==='agents') tags.push('automation');
    if(a.compliance==='hipaa'||a.compliance==='soc2') {tags.push('enterprise');tags.push('legal');}
    if(a.compliance==='gdpr')   tags.push('enterprise');
    if(a.build_vs_buy==='finetune'||a.build_vs_buy==='infra') {tags.push('api_builder');tags.push('coding');}
    if(a.build_vs_buy==='rag'||a.build_vs_buy==='api_consumer') tags.push('api_hybrid');
    tags.push('api_builder'); // build mode always includes builder section
    session.answers.builder='builder'; // force builder section in Step 3
  } else {
    // Idea mode — derive tags from goal + context answers
    const Qs=IDEA_QUESTIONS;
    Qs.forEach(q=>{ if(a[q.id]) tags.push(q.options.find(o=>o.value===a[q.id])?.tag); });
    if(a.goal_type==='creator')    {tags.push('creator');tags.push('youtube');}
    if(a.goal_type==='content')    {tags.push('content');tags.push('writing');}
    if(a.goal_type==='researcher') tags.push('researcher');
    if(a.goal_type==='automation') tags.push('automation');
    if(a.goal_type==='agency')     {tags.push('agency');tags.push('freelance');}
    if(a.goal_type==='product')    {tags.push('developer');tags.push('product');}
    if(a.output_format==='video')  tags.push('video');
    if(a.output_format==='audio')  tags.push('audio');
    if(a.output_format==='text')   tags.push('writing');
    if(a.output_format==='visual') tags.push('content');
    if(a.output_format==='docs')   tags.push('presentations');
    if(a.output_format==='data')   {tags.push('dataanalysis');tags.push('presentations');}
    if(a.domain==='legal')    tags.push('legal');
    if(a.domain==='sales')    tags.push('sales');
    if(a.domain==='research') {tags.push('researcher');tags.push('dataanalysis');}
    if(a.domain==='marketing') tags.push('marketer');
  }
  return [...new Set(tags)].filter(Boolean);
}

function buildStack(session){
  // session passed as parameter
  const isBuild=session.mode==='build';
  const budget=session.answers.budget||'low';
  const skill=isBuild?'power':(session.answers.skill||'intermediate');
  const team=(()=>{
    if(session.answers.teamSize) return session.answers.teamSize;
    // Infer from goal_type if no explicit team answer
    const g=session.answers.goal_type||'';
    if(g==='agency'||g==='product') return 'small';
    if(g==='enterprise') return 'large';
    return 'solo';
  })();
  const timeline=session.answers.timeline||'month';
  const compliance=session.answers.compliance||'none';
  const buildVsBuy=session.answers.build_vs_buy||'api_consumer';
  const modelNeed=session.answers.model_need||'text';
  const latency=session.answers.latency||'fast';
  const existingStack=session.answers.existing_tools||session.answers.existing_stack||'';

  // ── PHASE 1: HARD CONSTRAINT FILTERS ─────────────────────────
  // Each filter records WHY tools were removed. Order matters — most
  // restrictive first so later filters see a smaller pool.
  const eliminated={};
  const filterLog=[];

  function hardElim(toolId, reason){
    if(!eliminated[toolId]) eliminated[toolId]=reason;
  }

  // COMPLIANCE — strictest filter: only keep tools that explicitly
  // support the required standard. Everything else is eliminated.
  const HIPAA_SAFE=['azure-openai','vertex-ai','cohere','glean','copilot',
    'writer','salesforce-einstein','harvey','microsoft-365'];
  const SOC2_SAFE=['azure-openai','vertex-ai','cohere','glean','copilot',
    'writer','salesforce-einstein','harvey','notion-ai','claude','chatgpt',
    'claude-api','openai-api','github-copilot','cursor','grammarly'];
  const GDPR_SAFE=['azure-openai','vertex-ai','claude','claude-api','openai-api',
    'chatgpt','gemini','cohere','mistral','ollama'];

  if(compliance==='hipaa'){
    TOOLS.forEach(t=>{ if(!HIPAA_SAFE.includes(t.id)) hardElim(t.id,'Removed: no HIPAA compliance documentation'); });
    filterLog.push({icon:'🔒',msg:`HIPAA filter active — showing only ${HIPAA_SAFE.length} verified-compliant tools`});
  } else if(compliance==='soc2'){
    TOOLS.forEach(t=>{ if(!SOC2_SAFE.includes(t.id)) hardElim(t.id,'Removed: SOC 2 compliance not confirmed'); });
    filterLog.push({icon:'🔒',msg:`SOC 2 filter active — compliance-verified tools only`});
  } else if(compliance==='gdpr'){
    TOOLS.forEach(t=>{ if(!GDPR_SAFE.includes(t.id)) hardElim(t.id,'Removed: EU data residency not confirmed'); });
    filterLog.push({icon:'🇪🇺',msg:`GDPR filter active — EU data processing tools only`});
  }

  // BUDGET: free-only → hard eliminate all paid-only tools
  if(budget==='none'){
    TOOLS.forEach(t=>{ if(!t.free?.available) hardElim(t.id,'Removed: no free tier available'); });
    const elimCount=Object.values(eliminated).filter(r=>r.includes('free tier')).length;
    if(elimCount>0) filterLog.push({icon:'💸',msg:`Free-only mode — removed ${elimCount} paid tools from consideration`});
  }

  // SKILL: beginner → hard eliminate dev/infra tools (not beginner-friendly)
  if(skill==='beginner'){
    TOOLS.forEach(t=>{
      const meta=TOOL_META[t.id]||{};
      // Only eliminate if NOT already eliminated and NOT beginner-friendly
      // Exception: never eliminate tools with beginner:true
      if(!meta.beginner && (t.isDev||t.isInfra||t.isMCP||t.isModel)){
        hardElim(t.id,'Removed: requires technical expertise');
      }
    });
    filterLog.push({icon:'🎓',msg:`Beginner mode — technical infrastructure tools hidden`});
  }

  // TIMELINE: asap → eliminate tools with known long setup curves
  const LONG_SETUP=['langgraph','autogen','semantic-kernel','haystack','ragas',
    'arize','deepeval','braintrust','salesforce-einstein','harvey','glean'];
  if(timeline==='asap'||timeline==='week'){
    LONG_SETUP.forEach(id=>hardElim(id,'Removed: setup time exceeds your timeline'));
    filterLog.push({icon:'⚡',msg:`Fast-setup mode — tools needing 2+ weeks to deploy hidden`});
  }

  // TEAM SIZE: solo/small → eliminate pure enterprise tools
  // Enterprise tools need procurement, IT buy-in, and minimum seats
  const ENTERPRISE_ONLY=['glean','harvey','salesforce-einstein','copilot-studio'];
  if(team==='solo'||team==='small'){
    ENTERPRISE_ONLY.forEach(id=>hardElim(id,'Removed: requires enterprise procurement'));
  }

  // MCP SERVERS: only show in results for dev/agent goals or build mode
  const hasMCPGoal=session.goalTags.some(t=>['developer','coding','agentbuilder','mcpsetup'].includes(t));
  if(!isBuild&&!hasMCPGoal){
    TOOLS.forEach(t=>{ if(t.isMCP) hardElim(t.id,'MCP server — shown in developer/agent stacks'); });
  }

  // Log total eliminated
  const elimTotal=Object.keys(eliminated).length;
  const candidatePool=TOOLS.filter(t=>!eliminated[t.id]);

  // ── PHASE 2: SOFT SCORING on surviving candidates only ────────
  const scores={};

  candidatePool.forEach(t=>{
    let score=0;
    const meta=TOOL_META[t.id]||{};

    // Base: GOAL_WEIGHTS — the primary signal
    session.goalTags.forEach(tag=>{
      if(GOAL_WEIGHTS[tag]&&GOAL_WEIGHTS[tag][t.id]) score+=GOAL_WEIGHTS[tag][t.id];
    });

    // BUDGET soft shaping (tools that survived hard filter but cost more get modest penalty)
    if(budget==='low'){
      const p=t.paid[0]?.price||'';
      const n=parseFloat(p.replace(/[^0-9.]/g,''));
      if(!t.free?.available&&n>50) score=Math.floor(score*0.7);
      else if(t.free?.available) score+=1; // slight free-tier bonus
    }

    // SKILL soft shaping
    if(skill==='power'&&!meta.beginner) score+=2; // power users prefer capable tools
    if(skill==='intermediate'&&meta.beginner) score+=1;

    // TEAM SIZE soft boosts
    if(meta.enterprise&&team==='large') score+=4;
    if(!meta.enterprise&&team==='solo') score+=2;
    if(!meta.enterprise&&team==='small') score+=1;

    // EXISTING STACK integration affinity
    // If the user mentioned tools they already use, boost tools that integrate well
    const existingTools=existingStack.toLowerCase();
    if(existingTools&&existingTools!=='none'){
      // Map question answer values to integration keyword patterns
      const STACK_MAP={
        'google':  ['google','gmail','sheets','drive','workspace','docs'],
        'notion':  ['notion','obsidian'],
        'design':  ['canva','figma','adobe','creative cloud'],
        'comms':   ['slack','teams','zoom','microsoft'],
        'code':    ['github','vs code','cursor','git','vscode','visual studio'],
        'zapier':  ['zapier','make','n8n'],
        'salesforce':['salesforce','hubspot','crm'],
      };
      const keywords=STACK_MAP[existingTools]||[existingTools];
      const integrations=(t.integrations||[]).map(i=>i.toLowerCase());
      const matches=integrations.filter(i=>keywords.some(kw=>i.includes(kw)));
      if(matches.length>0) score+=matches.length*2; // 2pts per matching integration
    }

    // BUILD-MODE specific scoring
    if(isBuild){
      // Model need alignment — strong signal
      if(modelNeed==='code'){
        if(['cursor','github-copilot','deepseek','claude-code','windsurf'].includes(t.id)) score+=7;
        if(['claude-api','openai-api','claude'].includes(t.id)) score+=4;
      }
      if(modelNeed==='voice'&&['elevenlabs','otter-ai','whisper'].includes(t.id)) score+=7;
      if(modelNeed==='agents'&&t.agents?.hasAgents) score+=6;
      if(modelNeed==='agents'&&['langgraph','crewai','autogen','openai-agents'].includes(t.id)) score+=4;
      if(modelNeed==='embed'&&['pinecone','notebooklm','perplexity'].includes(t.id)) score+=6;
      if(modelNeed==='vision'&&t.scores?.multimodal>=7) score+=5;

      // Build vs buy — strong architectural preference signal
      if(buildVsBuy==='infra'||buildVsBuy==='finetune'){
        if(t.isModel||t.isInfra) score+=7;
        if(['llama','mistral','gemma','ollama','together-ai'].includes(t.id)) score+=3;
      }
      if(buildVsBuy==='api_consumer'){
        if(!t.isModel&&!t.isInfra&&!t.isMCP) score+=3;
        if(['claude-api','openai-api','claude'].includes(t.id)) score+=4;
      }
      if(buildVsBuy==='rag'){
        if(['pinecone','langchain','haystack','notebooklm'].includes(t.id)) score+=7;
        if(['mcp-postgres','mcp-supabase'].includes(t.id)) score+=4;
      }

      // Latency requirements
      if(latency==='realtime'&&['groq','cursor','deepseek','claude-api'].includes(t.id)) score+=5;
      if(latency==='realtime'&&t.scores?.automation>=8) score+=2;

      // Evaluation/observability boost for build mode
      if(['langsmith','helicone','promptfoo','arize'].includes(t.id)) score+=3;
    }

    if(score>0) scores[t.id]=score;
  });

  // ── PHASE 3: LAYER-AWARE SELECTION ────────────────────────────
  const pickedLayers={};
  const recs=[];

  const sorted=Object.entries(scores)
    .sort((a,b)=>b[1]-a[1])
    .map(([id])=>id);

  // Desired layer coverage based on goal and mode
  const hasDev=session.goalTags.some(t=>['developer','coding','product','agentbuilder'].includes(t));
  const hasEnterprise=session.goalTags.some(t=>['enterprise','large_team'].includes(t))||team==='large';

  const wantedLayers=new Set(['creation']);
  if(!hasDev) wantedLayers.add('capture');
  wantedLayers.add('orchestration');
  wantedLayers.add('knowledge');
  if(hasEnterprise||compliance!=='none') wantedLayers.add('governance');
  if(isBuild) wantedLayers.add('governance'); // always show governance in build mode

  // First pass: best tool per primary layer
  for(const id of sorted){
    if(recs.length>=5) break;
    const t=TOOLS.find(x=>x.id===id);
    if(!t) continue;
    const meta=TOOL_META[id];
    if(!meta) continue;
    const layer=meta.primary;
    if(!pickedLayers[layer]&&wantedLayers.has(layer)){
      pickedLayers[layer]=id;
      recs.push({tool:t, layer, score:scores[id]});
    }
  }

  // Second pass: fill gaps via secondary layers
  for(const id of sorted){
    if(recs.length>=5) break;
    if(recs.find(r=>r.tool.id===id)) continue;
    const t=TOOLS.find(x=>x.id===id);
    if(!t) continue;
    const meta=TOOL_META[id];
    if(!meta) continue;
    for(const sl of (meta.secondary||[])){
      if(!pickedLayers[sl]&&wantedLayers.has(sl)){
        pickedLayers[sl]=id;
        recs.push({tool:t, layer:sl, score:scores[id]});
        break;
      }
    }
  }

  // Safety net: ensure at least 3 tools
  if(recs.length<3){
    for(const id of sorted){
      if(recs.length>=3) break;
      if(recs.find(r=>r.tool.id===id)) continue;
      const t=TOOLS.find(x=>x.id===id);
      if(t) recs.push({tool:t, layer:(TOOL_META[id]||{}).primary||'creation', score:scores[id]||1});
    }
  }

  // Attach constraint metadata for UI rendering
  session._constraintLog=filterLog;
  session._eliminatedCount=elimTotal;
  session._candidateCount=candidatePool.length;

  return recs.slice(0,5);
}

function estimateOutcomes(stack, session){
  if (!session) session = {};
  const budget=session.answers.budget||'low';
  const goalTags=session.goalTags;
  const skill=session.answers.skill||'intermediate';

  // ── Monthly cost ────────────────────────────────────────────────
  let monthlyCost=0;
  stack.forEach(({tool})=>{
    if(!tool.free.available){
      const p=tool.paid[0]?.price||'$0';
      monthlyCost+=parseFloat(p.replace(/[^0-9.]/g,''))||20;
    }
  });
  const costBand=monthlyCost===0?'$0/mo (free stack)':monthlyCost<30?`~$${Math.round(monthlyCost)}/mo`:monthlyCost<80?`~$${Math.round(monthlyCost)}/mo`:`~$${Math.round(monthlyCost)}/mo`;

  // ── Hours saved — goal-specific estimates ──────────────────────
  // Based on industry benchmarks: McKinsey 2024 (3.5 hrs/day), Nielsen Norman Group AI studies
  let hrMin=0, hrMax=0;
  const hasOrchestration=stack.some(r=>r.layer==='orchestration');
  const hasCreation=stack.some(r=>r.layer==='creation');
  const hasKnowledge=stack.some(r=>r.layer==='knowledge');

  if(goalTags.includes('writing')||goalTags.includes('content')){
    hrMin=4; hrMax=9; // Writing AI tools cut drafting time 50-70% per Nielsen Norman
  } else if(goalTags.includes('developer')||goalTags.includes('coding')){
    hrMin=6; hrMax=12; // GitHub 2023 study: Copilot cuts coding time 55%
  } else if(goalTags.includes('researcher')){
    hrMin=3; hrMax=7; // Research tools cut literature review time 60-80%
  } else if(goalTags.includes('automation')){
    hrMin=5; hrMax=15; // Automation eliminates repetitive tasks wholesale
  } else if(goalTags.includes('video')||goalTags.includes('creator')){
    hrMin=3; hrMax=8; // AI video/audio tools cut production time 40-60%
  } else if(goalTags.includes('sales')){
    hrMin=4; hrMax=8; // Sales AI cuts prospecting and outreach prep 50-70%
  } else {
    // Base estimate from layer coverage
    stack.forEach(({layer})=>{
      if(layer==='orchestration'){hrMin+=4;hrMax+=10;}
      else if(layer==='creation'){hrMin+=2;hrMax+=5;}
      else if(layer==='knowledge'){hrMin+=2;hrMax+=4;}
      else if(layer==='capture'){hrMin+=1;hrMax+=3;}
    });
  }

  // ── 3-month ROI projection ────────────────────────────────────
  // Assumes ~$50/hr knowledge worker opportunity cost (conservative)
  const hourlyRate=50;
  const weeksPerMonth=4.3;
  const monthlyTimeSavedMin=hrMin*weeksPerMonth;
  const monthlyTimeSavedMax=hrMax*weeksPerMonth;
  const monthlyValueMin=Math.round(monthlyTimeSavedMin*hourlyRate);
  const monthlyValueMax=Math.round(monthlyTimeSavedMax*hourlyRate);
  const quarterlyROIMin=Math.round((monthlyValueMin*3-monthlyCost*3)/(monthlyCost*3||1)*100);
  const quarterlyROIMax=Math.round((monthlyValueMax*3-monthlyCost*3)/(monthlyCost*3||1)*100);
  const roiText=monthlyCost===0
    ?'Infinite (zero cost stack)'
    :`${quarterlyROIMin}–${quarterlyROIMax}% at 3 months`;

  // ── Content output projection ──────────────────────────────────
  let contentOutput='';
  let contentDetail='';
  if(goalTags.includes('youtube')||goalTags.includes('video')){
    const hasAI=stack.some(r=>r.tool.id==='heygen'||r.tool.id==='runway'||r.tool.id==='sora');
    contentOutput=hasAI?'2–3 videos/week':'1–2 videos/week';
    contentDetail=hasAI?'AI-generated video cuts production time from 8 hrs to ~2.5 hrs per video':'AI scripting and editing tools — final production still manual';
  } else if(goalTags.includes('writing')||goalTags.includes('content')){
    contentOutput='12–20 pieces/month';
    contentDetail='vs. 4–6 manually — AI handles first draft, you edit for voice';
  } else if(goalTags.includes('developer')||goalTags.includes('coding')){
    contentOutput='55% faster feature delivery';
    contentDetail='GitHub 2023 developer survey: median time-to-completion drops by more than half with AI coding tools';
  } else if(goalTags.includes('researcher')){
    contentOutput='3× more sources reviewed';
    contentDetail='AI research tools let you process 3–5× as many papers and sources in the same time';
  } else if(goalTags.includes('sales')){
    contentOutput='2–3× more outreach';
    contentDetail='AI personalisation and drafting tools cut per-email time from 20 min to 5–7 min';
  }

  // ── Payback period ────────────────────────────────────────────
  let payback='';
  if(monthlyCost>0&&hrMin>0){
    const breakEvenDays=Math.ceil((monthlyCost/(hrMin*weeksPerMonth*hourlyRate/30)));
    payback=breakEvenDays<=3?'Pays back within 3 days of productive use'
           :breakEvenDays<=7?`Pays back within ~${breakEvenDays} days`
           :breakEvenDays<=14?'Pays back in ~2 weeks'
           :'Pays back within the first month';
  }

  // ── Benchmark source note ─────────────────────────────────────
  const benchmarkNote='Hours-saved estimates based on McKinsey 2024 AI productivity research and GitHub/Nielsen Norman Group developer studies.';

  // Where it breaks down
  let breakdown='';
  if(budget==='none') breakdown='Free tiers work for getting started. Expect daily/monthly output caps — most free tools allow 20–50 AI generations before throttling. Paid plans unlock at $15–25/month.';
  else if(skill==='beginner') breakdown='Beginner-friendly stack — no setup required. You\'ll get 80% of the value in week 1. The remaining 20% comes from learning each tool\'s prompting style over time.';
  else breakdown='This covers the core workflow. At scale, add a governance layer (Writer, Glean) for team-wide consistency. Most users hit the ceiling of this stack at ~6 months.';

  return {costBand, hrMin, hrMax, contentOutput, contentDetail, payback, roiText, monthlyValueMin, monthlyValueMax, contextSwitch:`${stack.length} tools`, toolCount:stack.length, breakdown, benchmarkNote};
}

function getToolReason(tool, layer, goalTags, answers, session){
  if (!session) session = {};
  const budget=answers.budget||'low';
  const skill=answers.skill||'intermediate';
  const id=tool.id;

  const REASONS={
    'claude':     ['Scores 9/10 for writing and research — follows complex instructions better than any other model','No free tier time limit, just daily message cap'],
    'chatgpt':    ['Scores 8/10 across writing, coding, and creativity — the most versatile general-purpose AI','Free tier has no time limit, just hourly caps'],
    'gemini':     ['Unlimited free tier on Flash model — best cost-to-capability ratio at $0','Multimodal from day one: image, audio, and text in one context'],
    'cursor':     ['Best-in-class coding agent — edits multiple files at once, understands your full codebase','Free tier covers most individual dev work'],
    'github-copilot':['Integrates directly into GitHub for PR reviews and CI — worth it if you\'re already on GitHub','Available free for students and open-source contributors'],
    'lovable':    ['Describe an app in plain English and it deploys it — lowest floor for non-developers','No backend setup, no deployment config — genuinely zero-code'],
    'n8n':        ['400+ connectors, AI Agent nodes, runs on a schedule — free to self-host','Steeper learning curve than Zapier but far more powerful and free'],
    'openclaw':   ['Runs on your own machine — executes real tasks via WhatsApp/Telegram without a cloud subscription','310K+ GitHub stars, MIT licence, model-agnostic'],
    'notebooklm': ['Fully free — upload your docs and ask questions across all of them simultaneously','Best tool for working with your own content rather than the open web'],
    'perplexity': ['Cites every source so you can verify claims — unlike ChatGPT which can hallucinate confidently','Real-time web access, unlike most models which have a training cutoff'],
    'canva-ai':   ['50 AI image credits per month on the free plan, plus 1M+ templates','Design tool + AI generation in one — no separate subscription for graphics'],
    'heygen':     ['Create talking-head videos from a script without filming yourself — fastest path to YouTube content','Avatar quality is good enough for professional use at the $29/mo Creator tier'],
    'elevenlabs': ['Best voice cloning and TTS on the market — 10,000 characters/month free','Pairs directly with HeyGen for a complete script-to-video pipeline'],
    'otter-ai':   ['Automatic meeting transcription, action items, and Slack sync — free tier covers 300 minutes/month','Saves 30–60 minutes per meeting in manual note-taking'],
    'notion-ai':  ['AI embedded in your knowledge base — no copy-pasting between tools','Good enough for most daily tasks; not a replacement for Claude on complex writing'],
    'elicit':     ['Searches 200M+ academic papers — purpose-built for literature review and research synthesis','Extracts structured data from studies; ChatGPT cannot do this reliably'],
    'writer':     ['Enforces your brand voice automatically across every team member\'s output','SOC 2, HIPAA, GDPR — the only writing AI built for enterprise compliance'],
    'cohere':     ['Deploy LLMs on-premises — your data never leaves your infrastructure','Best-in-class RAG and embeddings for building AI into your own product'],
    'glean':      ['Searches Slack, Drive, Confluence, Jira, Salesforce in one place — nothing falls through the cracks','Mirrors your existing permissions: users only see what they\'re authorised to see'],
    'salesforce-einstein':['Agentforce handles customer queries autonomously — built into the CRM you already use','Lead scoring and deal prediction trained on your own pipeline data'],
    'copilot':    ['If you\'re already on Microsoft 365, this is the highest-ROI AI purchase — it\'s inside every app you already use','Writes DAX, VBA, and Outlook emails from plain English'],
    'deepseek':   ['Near-zero API cost with benchmark scores close to GPT-4 — best value for high-volume code generation','Open weights — deployable on your own infrastructure'],
    'gong':       ['Records and analyses every sales call — flags at-risk deals before they slip','The most-used sales intelligence tool in enterprise; integrates with every major CRM'],
    'harvey':     ['Purpose-built for legal — contract analysis and due diligence at law firm quality','Used by top-tier firms; not a consumer product dressed up in legal clothing'],
    'runway':     ['Gen-3 Alpha produces the highest-quality AI video currently available','Best for cinematic and creative video; more complex than Pika but significantly better output'],
    'midjourney': ['Consistently produces the most distinctive, high-quality images of any AI tool','A 7/10 creativity score — outputs are genuinely surprising, not generic'],
    'adobe-firefly':['Trained on licensed Adobe Stock — commercially safe for brands','Integrated into Creative Cloud apps you may already pay for'],
    'freepik':    ['20 free AI images per day — no subscription needed for most marketing needs','Fast and good enough for social posts; step up to Midjourney when quality matters more'],
    'khanmigo':   ['Free for US teachers — purpose-built tutoring AI with curriculum alignment','Socratic method: it asks questions to build understanding, not just gives answers'],
    'fitbod':     ['Adapts every workout to your recovery state and available equipment — not just a static plan','3 free workouts to try before committing; $13/month after'],
    'wolfram':    ['Actually computes answers step-by-step — essential for maths, science, and data verification','Does not hallucinate mathematical results, unlike general LLMs'],
    'pika':       ['Easiest interface for short-form video and effects — best starting point for social content','Lower ceiling than Runway but much faster to produce results'],
    'seedance':   ['Multi-reference input for consistent characters, native audio generation, and free daily credits','Global launch still limited — access via CapCut; standalone app postponed'],
    'synthesia':  ['Enterprise avatar video with 160+ AI presenters — purpose-built for training and corporate comms','SOC 2 compliant, GDPR ready — the enterprise version of HeyGen'],
  };

  const reasons=REASONS[id]||[`Scores ${tool.scores.writing}/10 writing, ${tool.scores.coding}/10 coding, ${tool.scores.automation}/10 automation`,tool.free.available?`Free tier available — ${tool.free.desc.split('.')[0]}`:`From ${tool.paid[0]?.price||'Free'}`];

  const tradeoff= budget==='none'&&!tool.free.available?`⚠️ No free tier — skip for now, revisit when you have budget`:
                  skill==='beginner'&&(TOOL_META[id]||{}).beginner===false?`⚠️ Steeper learning curve — worth the effort but allow a week to get productive`:
                  tool.paid[0]?.price?.includes('Custom')?`⚠️ Enterprise pricing — request a demo to get a quote`:
                  '';

  return {why:reasons[0], detail:reasons[1]||'', tradeoff};
}

module.exports = { buildStack, estimateOutcomes, getToolReason, buildDerivedTags, parseGoal };
