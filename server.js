require('dotenv').config({ path: '.env.local' });
const express = require('express');
const path = require('path');
const OpenAI = require('openai');
const multer = require('multer');
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
    const secretKey = JSON.parse(process.env.POOL_PRIVATE_KEY);
    poolKeypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
    console.log('Pool wallet loaded:', poolKeypair.publicKey.toBase58());
  } catch (e) {
    console.log('Pool wallet not configured');
  }
}

// Jobs database (in production, use real DB)
const jobs = [
  {
    id: 1,
    title: "Create a meme about AI taking over jobs",
    description: "Make a funny meme about AI replacing human workers. Must be original, funny, and shareable.",
    reward: 0.05,
    difficulty: "Easy",
    timeEstimate: "10 min",
    verificationPrompt: "Is this a funny, original meme about AI taking over jobs or replacing workers?"
  },
  {
    id: 2,
    title: "Write a tweet thread about $JOBAI",
    description: "Write a 3-5 tweet thread explaining what JobAI is and why it matters. Screenshot your posted tweets.",
    reward: 0.08,
    difficulty: "Easy", 
    timeEstimate: "15 min",
    verificationPrompt: "Does this show a tweet thread (3-5 tweets) about JobAI explaining what it is?"
  },
  {
    id: 3,
    title: "Design a $JOBAI logo concept",
    description: "Create a simple logo concept for JobAI. Should be minimal, tech-focused, and work in green/black.",
    reward: 0.15,
    difficulty: "Medium",
    timeEstimate: "30 min",
    verificationPrompt: "Is this a logo design for JobAI? Is it minimal and tech-focused with green/black colors?"
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
      return res.status(404).json({ error: 'Job not found' });
    }

    console.log(`\n📥 Submission for: "${job.title}"`);
    console.log(`   Wallet: ${wallet}`);
    console.log(`   Has image: ${!!imageFile}`);
    console.log(`   Text: ${proofText || 'none'}`);

    // Verify with AI if configured
    let approved = false;
    let reason = '';

    if (openai && imageFile) {
      console.log('🤖 Verifying with AI...');
      
      const base64Image = imageFile.buffer.toString('base64');
      const mimeType = imageFile.mimetype;

      const response = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are a work verification AI. Analyze the submitted proof image and determine if the task was completed. Be fair but not too strict. Respond with JSON: { "approved": true/false, "reason": "brief explanation" }'
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `Task: ${job.title}\nDescription: ${job.description}\nVerification question: ${job.verificationPrompt}\n\nAdditional info from worker: ${proofText || 'none'}\n\nDid they complete this task?`
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
      
      console.log(`   AI verdict: ${approved ? '✅ Approved' : '❌ Rejected'}`);
      console.log(`   Reason: ${reason}`);
    } else {
      // Demo mode - auto approve
      approved = true;
      reason = 'Auto-approved (demo mode)';
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
        // Still mark as approved, payment can be retried
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
  console.log(`💼 JobAI running at http://localhost:${PORT}`);
  if (!openai) console.log('⚠️  OpenAI not configured - running in demo mode');
  if (!poolKeypair) console.log('⚠️  Pool wallet not configured - payments disabled');
});
