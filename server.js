import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();
const app = express();
app.use(express.json());

// Allow your GitHub Pages origin
app.use(cors({
  origin: ["https://srr-459.github.io"],
  methods: ["GET", "POST"],
  allowedHeaders: ["Content-Type"]
}));

// Environment variables
const PORT = process.env.PORT || 10000;
const OT_TENANT_BASE_URL = process.env.OT_TENANT_BASE_URL;
const OT_TEMPLATE_GUID = process.env.OT_TEMPLATE_GUID;
const OT_ORG_GROUP_GUID = process.env.OT_ORG_GROUP_GUID;
const OT_SECTION_ID = process.env.OT_SECTION_ID;
const OT_QUESTION_ID1 = process.env.OT_QUESTION_ID1;
const OT_QUESTION_ID2 = process.env.OT_QUESTION_ID2;
const OT_QUESTION_ID3 = process.env.OT_QUESTION_ID3;
const OT_RESPONSE_ID1 = process.env.OT_RESPONSE_ID1;
const OT_RESPONSE_ID2 = process.env.OT_RESPONSE_ID2;
const OT_RESPONSE_ID3 = process.env.OT_RESPONSE_ID3;
const OT_RESULT_ID = process.env.OT_RESULT_ID;
const OT_BEARER_TOKEN = process.env.OT_BEARER_TOKEN;
const OT_RESPONDENT_ID = process.env.OT_RESPONDENT_ID; // must be valid GUID

// Helper for headers
const otHeaders = () => ({
  "Authorization": `Bearer ${OT_BEARER_TOKEN}`,
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain"
});

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Main flow
app.post("/api/run-flow", async (req, res) => {
  const { q1, q2, name } = req.body;
  const respondentName = name || "Anonymous";
  const result = { input: { q1, q2, name }, steps: [] };

  try {
    // Step 1: Create assessment (WordPress schema mirrored)
    const createBody = {
      respondents: [{
        isRespondentOfApproverSection: false,
        respondentId: OT_RESPONDENT_ID,
        respondentName
      }],
      respondentCreationType: "PROJECT_RESPONDENT",
      userAssignmentMode: "ASSESSMENT",
      creationSource: "DEFAULT",
      checkForInFlightAssessments: false,
      duplicateNotAllowed: false,
      name: `WP Assessment - ${new Date().toISOString()}`,
      orgGroupId: OT_ORG_GROUP_GUID,
      templateRootVersionId: OT_TEMPLATE_GUID
    };

    const createResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(createBody)
    });

    const createText = await createResp.text();
    console.log("Create response raw:", createText);

    let createData;
    try {
      createData = JSON.parse(createText);
    } catch {
      createData = { raw: createText };
    }

    const assessmentId = createData.assessmentId || createData.id;
    result.steps.push({ step: "create", status: createResp.status, assessmentId, error: createData });

    if (!assessmentId) {
      return res.json({ error: "No assessmentId", result });
    }

    // Step 2: Save responses (WordPress schema mirrored)
const responsesBody = {
  sectionId: OT_SECTION_ID,
  responses: [
    {
      questionId: OT_QUESTION_ID1,
      responseId: OT_RESPONSE_ID1,
      respondentId: OT_RESPONDENT_ID,
      respondentName,
      isRespondentOfApproverSection: false
    },
    {
      questionId: OT_QUESTION_ID2,
      responseId: OT_RESPONSE_ID2,
      respondentId: OT_RESPONDENT_ID,
      respondentName,
      isRespondentOfApproverSection: false
    },
    {
      questionId: OT_QUESTION_ID3,
      responseId: OT_RESPONSE_ID3,
      respondentId: OT_RESPONDENT_ID,
      respondentName,
      isRespondentOfApproverSection: false
    }
  ]
};


    // Step 3: Submit assessment
    const submitResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/submit`, {
      method: "POST", headers: otHeaders()
    });
    result.steps.push({ step: "submit", status: submitResp.status });

    // Step 4: Review assessment
    const reviewBody = {
      assessmentId,
      resultId: OT_RESULT_ID,
      reviewStatus: "Completed"
    };

    const reviewResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/reviews`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(reviewBody)
    });
    result.steps.push({ step: "review", status: reviewResp.status });

    res.json({ message: "Assessment flow completed", assessmentId, result });

  } catch (err) {
    console.error("Error in run-flow:", err);
    res.status(500).json({ error: err.message, result });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
