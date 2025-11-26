import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { corsHeaders } from "https://deno.land/std@0.168.0/http/cors.ts";

const ABSTRACT_API_PHONE = Deno.env.get("ABSTRACT_API_PHONE") || "";
const ABSTRACT_API_EMAIL = Deno.env.get("ABSTRACT_API_EMAIL") || "";
const CLAUDE_API_KEY = Deno.env.get("CLAUDE_API_KEY") || "";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { candidateEmail, candidatePhone, resumeText } = await req.json();

    if (!candidateEmail || !candidatePhone) {
      return new Response(
        JSON.stringify({ error: "Email and phone are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. Validate email
    const emailValidation = await fetch(
      `https://emailvalidation.abstractapi.com/v1/?api_key=${ABSTRACT_API_EMAIL}&email=${encodeURIComponent(candidateEmail)}`
    ).then(r => r.json());

    // 2. Validate phone
    const phoneValidation = await fetch(
      `https://phoneintelligence.abstractapi.com/v1/?api_key=${ABSTRACT_API_PHONE}&phone=${encodeURIComponent(candidatePhone)}`
    ).then(r => r.json());

    // 3. Check resume with Claude
    let aiProbability = 0;
    let aiReasoning = "Resume analysis complete";

    if (resumeText && resumeText.trim().length > 0) {
      const claudeResponse = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": CLAUDE_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-opus-4-1",
          max_tokens: 500,
          messages: [
            {
              role: "user",
              content: `Analyze this resume and determine if it was written by AI. Respond with ONLY a JSON object: {"probability": 0-100, "reasoning": "brief explanation"}\n\nResume:\n${resumeText}`,
            },
          ],
        }),
      }).then(r => r.json());

      if (claudeResponse.content && claudeResponse.content[0]) {
        try {
          let jsonText = claudeResponse.content[0].text.trim();
          jsonText = jsonText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          const parsed = JSON.parse(jsonText);
          aiProbability = parsed.probability || 0;
          aiReasoning = parsed.reasoning || "Resume analysis complete";
        } catch (e) {
          console.log("Parse error:", e);
        }
      }
    }

    // Calculate risk score
    let riskScore = 0;
    if (!emailValidation.is_valid_format || emailValidation.is_disposable) riskScore += 30;
    if (!phoneValidation.valid || phoneValidation.type === "voip") riskScore += 25;
    if (aiProbability > 70) riskScore += 45;
    else if (aiProbability > 40) riskScore += 25;

    let riskLevel = "Low";
    if (riskScore >= 80) riskLevel = "Critical";
    else if (riskScore >= 60) riskLevel = "High";
    else if (riskScore >= 40) riskLevel = "Medium";

    return new Response(
      JSON.stringify({
        success: true,
        riskScore: Math.min(100, riskScore),
        riskLevel,
        emailStatus: emailValidation.is_valid_format ? "Valid email format" : "Invalid email format",
        phoneStatus: phoneValidation.valid ? (phoneValidation.type === "voip" ? "VoIP/Suspicious" : "Valid phone") : "Invalid phone",
        aiAnalysis: aiReasoning,
        aiProbability,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
