import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();
const app = express();
app.use(express.json());

// Allow your GitHub Pages origin
const allowedOrigins = [
  "https://srr-459.github.io"
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error("Not allowed by CORS"));
  }
}));

// Load env vars
const {
  PORT = 10000,
  OT_TENANT_BASE_URL,
  OT_TEMPLATE_GUID,
  OT_ORG_GROUP_GUID,
  OT_SECTION_ID,
  OT_QUESTION_ID1,
  OT_QUESTION_ID2,
  OT_QUESTION_ID3,
  OT_RESPONSE_ID1,
  OT_RESPONSE_ID2,
  OT_RESPONSE_ID3,
  OT_RESULT_ID,
  OT_BEARER_TOKEN
} = process.env;

function otHeaders() {
  return {
    "Authorization": `Bearer ${OT_BEARER_TOKEN}`,
    "Content-Type": "application/json",
    "Accept": "application/json"
  };
}

app.get("/health", (req, res) => res.json({ ok: true }));

app.post("/api/run-flow", async (req, res) => {
  const { q1, q2, name } = req.body || {};
  if (!name) return res.status(400).json({ error: "Name required" });

  const result = { input: { q1, q2, name }, steps: [] };

  try {
    // Step 1: Create assessment
    const createBody = {
      respondents: [{ respondentId: "form-" + Date.now(), respondentName: name }],
      orgGroupId: OT_ORG_GROUP_GUID,
      templateRootVersionId: OT_TEMPLATE_GUID,
      name: `Assessment - ${new Date().toISOString()}`
    };
    const createResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(createBody)
    });
    const createData = await createResp.json();
    const assessmentId = createData.assessmentId;
    result.steps.push({ step: "create", status: createResp.status, assessmentId });

    if (!assessmentId) return res.status(502).json({ error: "No assessmentId", result });

    // Step 2: Submit responses
    const answerPayload = [
      {
        assessmentId,
        questionId: OT_QUESTION_ID1,
        sectionId: OT_SECTION_ID,
        responses: [{ response: "accept", responseId: OT_RESPONSE_ID1 }]
      },
      {
        assessmentId,
        questionId: OT_QUESTION_ID2,
        sectionId: OT_SECTION_ID,
        responses: [{ response: "accept", responseId: OT_RESPONSE_ID2 }]
      },
      {
        assessmentId,
        questionId: OT_QUESTION_ID3,
        sectionId: OT_SECTION_ID,
        responses: [{ response: name, responseId: OT_RESPONSE_ID3 }]
      }
    ];
    const answerResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/responses`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(answerPayload)
    });
    result.steps.push({ step: "responses", status: answerResp.status });

    // Step 3: Submit assessment
    const submitResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/submit`, {
      method: "POST", headers: otHeaders(), body: "{}"
    });
    result.steps.push({ step: "submit", status: submitResp.status });

    // Step 4: Complete review
    const reviewResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v1/assessments/${assessmentId}/review`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify({ resultId: OT_RESULT_ID })
    });
    result.steps.push({ step: "review", status: reviewResp.status });

    res.json({ message: "Assessment flow completed", assessmentId, result });
  } catch (err) {
    res.status(500).json({ error: err.message, result });
  }
});

app.listen(PORT, () => console.log(`Backend running on port ${PORT}`));
