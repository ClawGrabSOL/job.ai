require('dotenv').config({ path: '.env.local' });
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const multer = require('multer');
const bs58 = require('bs58');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ storage: multer.memoryStorage() });

// OpenAI for verification
let openai = null;
if (process.env.OPENAI_API_KEY) {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });
}

// Solana connection
const connection = new Connection(
  process.env.HELIUS_RPC || 'https://api.mainnet-beta.solana.com',
  'confirmed'
);

// Pool wallet (in production, load from secure env)
let poolKeypair = null;
if (process.env.POOL_PRIVATE_KEY) {
  try {
    let secretKey;
    const pk = process.env.POOL_PRIVATE_KEY.trim();
    
    if (pk.startsWith('[')) {
      // JSON array format: [1,2,3,...]
      secretKey = new Uint8Array(JSON.parse(pk));
    } else if (pk.includes(',')) {
      // Comma-separated format: 1,2,3,...
      secretKey = new Uint8Array(pk.split(',').map(n => parseInt(n.trim())));
    } else {
      // Base58 format (from Phantom, etc.)
      secretKey = bs58.decode(pk);
    }
    
    poolKeypair = Keypair.fromSecretKey(secretKey);
    console.log('🦀 Pool wallet loaded:', poolKeypair.publicKey.toBase58());
  } catch (e) {
    console.log('Pool wallet not configured:', e.message);
  }
}

// Clawdployer Tasks
const jobs = [
  {
    id: 1,
    title: "Create a Clawdbot tutorial video",
    description: "Record a short video (2-5 min) showing how to set up and use Clawdbot. Cover installation, basic commands, and one cool feature. Post to YouTube/TikTok.",
    reward: 0.25,
    difficulty: "Medium",
    timeEstimate: "45 min",
    verificationPrompt: "Does this show a video tutorial about Clawdbot? Look for: installation steps, command usage, demonstration of features. Should be 2-5 minutes and posted publicly."
  },
  {
    id: 2,
    title: "Write a Clawdbot skill",
    description: "Create a new skill for Clawdbot that adds useful functionality. Must include SKILL.md with proper documentation.",
    reward: 0.50,
    difficulty: "Hard",
    timeEstimate: "2-4 hrs",
    verificationPrompt: "Does this show a Clawdbot skill? Look for: SKILL.md file, proper folder structure, code files. Should include documentation and working code."
  },
  {
    id: 3,
    title: "Design Clawdployer banners",
    description: "Create a set of 3 social media banners for Clawdployer (Twitter header, Discord banner, and a 1080x1080 square). Red/black theme with the 🦀 crab.",
    reward: 0.15,
    difficulty: "Easy",
    timeEstimate: "30 min",
    verificationPrompt: "Does this show social media banners? Look for: red/black color scheme, crab emoji or crab imagery, multiple banner sizes, professional quality."
  },
  {
    id: 4,
    title: "Translate Clawdbot docs to Spanish",
    description: "Translate the main README and getting-started guide to Spanish. Must be natural, not machine-translated.",
    reward: 0.20,
    difficulty: "Medium",
    timeEstimate: "1 hr",
    verificationPrompt: "Does this show Spanish translations of Clawdbot documentation? Look for: natural Spanish language, complete translation of key docs, proper formatting."
  },
  {
    id: 5,
    title: "Create Clawd memes (set of 5)",
    description: "Make 5 high-quality memes about AI agents, Clawdbot, or the Clawd ecosystem. Must be funny, shareable, and use the 🦀 aesthetic.",
    reward: 0.10,
    difficulty: "Easy",
    timeEstimate: "20 min",
    verificationPrompt: "Does this show memes related to Clawd/Clawdbot/AI agents? Look for: humor, shareability, crab theme or AI agent theme, at least 5 distinct memes."
  },
  {
    id: 6,
    title: "Build a Clawdbot Discord bot integration",
    description: "Create a Discord bot that interfaces with Clawdbot via the gateway API. Should support basic commands like /ask and /status.",
    reward: 0.40,
    difficulty: "Hard",
    timeEstimate: "3-5 hrs",
    verificationPrompt: "Does this show a Discord bot integration with Clawdbot? Look for: working bot code, Discord.js or similar, API integration, command handlers."
  },
  {
    id: 7,
    title: "Write a Twitter thread about AI agents",
    description: "Write a 5-7 tweet thread explaining what AI agents are, why they matter, and how Clawdbot fits in. Post it live.",
    reward: 0.08,
    difficulty: "Easy",
    timeEstimate: "15 min",
    verificationPrompt: "Does this show a Twitter thread about AI agents? Look for: 5-7 tweets, educational content about AI agents, mention of Clawdbot, posted publicly."
  },
  {
    id: 8,
    title: "Research competing AI agent platforms",
    description: "Create a comparison doc analyzing 5 AI agent platforms (features, pricing, limitations). Include how Clawdbot compares.",
    reward: 0.18,
    difficulty: "Medium",
    timeEstimate: "1.5 hrs",
    verificationPrompt: "Does this show a comparison of AI agent platforms? Look for: at least 5 platforms compared, features/pricing analysis, Clawdbot comparison, document format."
  },
  {
    id: 9,
    title: "Create an ASCII art crab logo",
    description: "Design ASCII art crab (🦀) for terminal display. Should look good in monospace fonts and fit within 80 chars width.",
    reward: 0.06,
    difficulty: "Easy",
    timeEstimate: "20 min",
    verificationPrompt: "Does this show ASCII art of a crab? Look for: recognizable crab shape, fits in 80 character width, looks good in monospace, creative design."
  },
  {
    id: 10,
    title: "Report and document a Clawdbot bug",
    description: "Find a real bug in Clawdbot, document reproduction steps, and submit a proper GitHub issue. Must be a new, valid bug.",
    reward: 0.15,
    difficulty: "Medium",
    timeEstimate: "varies",
    verificationPrompt: "Does this show a valid bug report? Look for: clear reproduction steps, actual bug (not feature request), GitHub issue link, detailed description."
  }
];

// Serve pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/tasks', (req, res) => res.sendFile(path.join(__dirname, 'public', 'tasks.html')));
app.get('/payouts', (req, res) => res.sendFile(path.join(__dirname, 'public', 'payouts.html')));

// API: Get available jobs
app.get('/api/jobs', (req, res) => {
  res.json(jobs.map(j => ({
    id: j.id,
    title: j.title,
    description: j.description,
    reward: j.reward,
    difficulty: j.difficulty,
    timeEstimate: j.timeEstimate
  })));
});

// API: Submit proof of work
app.post('/api/submit', upload.single('image'), async (req, res) => {
  try {
    const { jobId, wallet, proofText } = req.body;
    const imageFile = req.file;

    if (!jobId || !wallet) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const job = jobs.find(j => j.id === parseInt(jobId));
    if (!job) {
      return res.status(404).json({ error: 'Task not found' });
    }

    console.log(`\n🦀 Submission for: "${job.title}"`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   Has image: ${!!imageFile}`);
    console.log(`   Notes: ${proofText || 'none'}`);

    // Verify with AI if configured
    let approved = false;
    let reason = '';

    if (openai && imageFile) {
      console.log('🤖 AI verification in progress...');
      
      const base64Image = imageFile.buffer.toString('base64');
      const mimeType = imageFile.mimetype;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: `You are a task verification AI for Clawdployer, a platform where humans complete tasks for the Clawd ecosystem. 
            
Analyze submissions fairly but thoroughly. Approve good-faith efforts that meet the core requirements. Reject low-effort or off-topic submissions.

Respond with JSON: { "approved": true/false, "reason": "brief explanation (1-2 sentences)" }`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Task: ${job.title}
Description: ${job.description}
Verification criteria: ${job.verificationPrompt}

Worker's notes: ${proofText || 'none'}

Does this submission complete the task?`
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:${mimeType};base64,${base64Image}`
                }
              }
            ]
          }
        ],
        response_format: { type: 'json_object' },
        max_tokens: 200
      });

      const result = JSON.parse(response.choices[0].message.content);
      approved = result.approved;
      reason = result.reason;
      
      console.log(`   Verdict: ${approved ? '✅ APPROVED' : '❌ REJECTED'}`);
      console.log(`   Reason: ${reason}`);
    } else {
      // Demo mode
      approved = true;
      reason = 'Auto-approved (demo mode - AI verification not configured)';
    }

    // Process payment if approved
    let txSignature = null;
    if (approved && poolKeypair) {
      try {
        console.log(`💸 Sending ${job.reward} SOL to ${wallet}...`);
        
        const toPublicKey = new PublicKey(wallet);
        const lamports = Math.floor(job.reward * LAMPORTS_PER_SOL);

        const transaction = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: poolKeypair.publicKey,
            toPubkey: toPublicKey,
            lamports: lamports,
          })
        );

        txSignature = await connection.sendTransaction(transaction, [poolKeypair]);
        await connection.confirmTransaction(txSignature);
        
        console.log(`   ✅ Payment sent! Tx: ${txSignature}`);
      } catch (payErr) {
        console.error('   ❌ Payment failed:', payErr.message);
      }
    }

    res.json({
      success: true,
      approved,
      reason,
      reward: approved ? job.reward : 0,
      txSignature
    });

  } catch (error) {
    console.error('Submit error:', error);
    res.status(500).json({ error: 'Failed to process submission' });
  }
});

// API: Get pool info
app.get('/api/pool', async (req, res) => {
  try {
    if (poolKeypair) {
      const balance = await connection.getBalance(poolKeypair.publicKey);
      res.json({
        address: poolKeypair.publicKey.toBase58(),
        balance: balance / LAMPORTS_PER_SOL
      });
    } else {
      res.json({
        address: 'Not configured',
        balance: 0
      });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to get pool info' });
  }
});

const PORT = process.env.PORT || 3003;
app.listen(PORT, () => {
  console.log(`\n🦀 Clawdployer running at http://localhost:${PORT}`);
  console.log(`   Tasks: ${jobs.length} deployed`);
  if (!openai) console.log('⚠️  OpenAI not configured - running in demo mode');
  if (!poolKeypair) console.log('⚠️  Pool wallet not configured - payments disabled');
  console.log('');
});
