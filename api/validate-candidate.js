module.exports = async function handler(req, res) {
  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { candidateName, candidateEmail, candidatePhone, linkedinUrl, resumeText } = req.body;

    // Validate inputs
    if (!candidateEmail || !candidatePhone) {
      return res.status(400).json({ error: 'Email and phone are required' });
    }

    // Get API keys from environment variables
    const abstractPhoneKey = process.env.ABSTRACT_API_PHONE;
    const abstractEmailKey = process.env.ABSTRACT_API_EMAIL;
    const claudeKey = process.env.CLAUDE_API_KEY;

    if (!abstractPhoneKey || !abstractEmailKey || !claudeKey) {
      return res.status(500).json({ error: 'Missing API keys' });
    }

    // 1. Validate email with Abstract API
    const emailValidation = await validateEmail(candidateEmail, abstractEmailKey);

    // 2. Validate phone with Abstract API
    const phoneValidation = await validatePhone(candidatePhone, abstractPhoneKey);

    // 3. Check if resume is AI-generated using Claude API
    const aiAnalysis = await checkResumeAI(resumeText || '', claudeKey);

    // Calculate overall risk score (0-100)
    let riskScore = 0;
    let riskLevel = 'Low';

    // Email risk
    if (!emailValidation.is_valid_format || emailValidation.is_disposable) {
      riskScore += 30;
    }

    // Phone risk (VoIP is riskier)
    if (!phoneValidation.valid || phoneValidation.type === 'voip') {
      riskScore += 25;
    }

    // AI detection risk
    if (aiAnalysis.aiDetectedProbability > 70) {
      riskScore += 45;
    } else if (aiAnalysis.aiDetectedProbability > 40) {
      riskScore += 25;
    }

    // Determine risk level
    if (riskScore >= 80) {
      riskLevel = 'Critical';
    } else if (riskScore >= 60) {
      riskLevel = 'High';
    } else if (riskScore >= 40) {
      riskLevel = 'Medium';
    } else {
      riskLevel = 'Low';
    }

    // Return results
    res.status(200).json({
      success: true,
      candidateName,
      candidateEmail,
      riskScore: Math.min(100, riskScore),
      riskLevel,
      emailStatus: emailValidation.is_valid_format ? 'Valid email format' : 'Invalid email format',
      emailValid: emailValidation.is_valid_format,
      phoneStatus: phoneValidation.valid ? (phoneValidation.type === 'voip' ? 'VoIP/Suspicious' : 'Valid phone') : 'Invalid phone',
      phoneValid: phoneValidation.valid && phoneValidation.type !== 'voip',
      aiAnalysis: aiAnalysis.analysis,
      details: `Email: ${emailValidation.is_valid_format ? '✓' : '✗'} | Phone: ${phoneValidation.valid ? '✓' : '✗'} | AI Resume: ${aiAnalysis.aiDetectedProbability > 50 ? '⚠️ Possible AI' : '✓ Human-written'}`
    });

  } catch (error) {
    console.error('Validation error:', error);
    res.status(500).json({ error: 'Validation failed', message: error.message });
  }
}

// Validate email with Abstract API
async function validateEmail(email, apiKey) {
  try {
    const response = await fetch(
      `https://emailvalidation.abstractapi.com/v1/?api_key=${apiKey}&email=${encodeURIComponent(email)}`
    );
    return await response.json();
  } catch (error) {
    console.error('Email validation error:', error);
    return { is_valid_format: false, is_disposable: true };
  }
}

// Validate phone with Abstract API
async function validatePhone(phone, apiKey) {
  try {
    const response = await fetch(
      `https://phoneintelligence.abstractapi.com/v1/?api_key=${apiKey}&phone=${encodeURIComponent(phone)}`
    );
    return await response.json();
  } catch (error) {
    console.error('Phone validation error:', error);
    return { valid: false, type: 'unknown' };
  }
}

// Check if resume is AI-generated using Claude API
async function checkResumeAI(resumeText, claudeKey) {
  try {
    if (!resumeText || resumeText.trim().length === 0) {
      return {
        aiDetectedProbability: 0,
        analysis: 'No resume text provided for analysis.'
      };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-1',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: `Analyze the following resume text and determine if it was likely written by AI (ChatGPT, Claude, etc.) or a human.

Resume:
${resumeText}

Respond ONLY with a JSON object in this exact format (no markdown, no code blocks):
{
  "probability": 0-100,
  "reasoning": "brief explanation"
}

Where probability is 0-100 (0 = definitely human, 100 = definitely AI).`
          }
        ]
      })
    });

    const data = await response.json();
    
    if (data.content && data.content[0]) {
      let jsonText = data.content[0].text.trim();
      
      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      
      const analysis = JSON.parse(jsonText);
      
      return {
        aiDetectedProbability: analysis.probability || 0,
        analysis: analysis.reasoning || 'Resume analysis complete'
      };
    }

    return {
      aiDetectedProbability: 0,
      analysis: 'Unable to analyze resume.'
    };

  } catch (error) {
    console.error('Claude API error:', error);
    return {
      aiDetectedProbability: 0,
      analysis: 'Resume analysis unavailable at this time.'
    };
  }
}
