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

// Environment variables (must be set in Render)
const PORT = process.env.PORT || 10000;
const OT_TENANT_BASE_URL = process.env.OT_TENANT_BASE_URL;        // e.g. https://uat.onetrust.com
const OT_TEMPLATE_GUID = process.env.OT_TEMPLATE_GUID;            // Template Root Version ID
const OT_ORG_GROUP_GUID = process.env.OT_ORG_GROUP_GUID;          // Org Group GUID
const OT_SECTION_ID = process.env.OT_SECTION_ID;                  // Section GUID for the questions
const OT_QUESTION_ID1 = process.env.OT_QUESTION_ID1;              // Q1 GUID (multi-choice)
const OT_QUESTION_ID2 = process.env.OT_QUESTION_ID2;              // Q2 GUID (multi-choice)
const OT_QUESTION_ID3 = process.env.OT_QUESTION_ID3;              // Q3 GUID (text)
const OT_RESPONSE_ID1 = process.env.OT_RESPONSE_ID1;              // Response option GUID for Q1 ("I agree")
const OT_RESPONSE_ID2 = process.env.OT_RESPONSE_ID2;              // Response option GUID for Q2 ("I agree")
const OT_RESPONSE_ID3 = process.env.OT_RESPONSE_ID3;              // (If text questions need a responseId in your tenant, set it; else leave blank)
const OT_RESULT_ID = process.env.OT_RESULT_ID;                    // Result GUID for review
const OT_BEARER_TOKEN = process.env.OT_BEARER_TOKEN;              // JWT without angle brackets
const OT_RESPONDENT_ID = process.env.OT_RESPONDENT_ID;            // Valid respondent GUID

// OneTrust headers
const otHeaders = () => ({
  "Authorization": `Bearer ${OT_BEARER_TOKEN}`,
  "Content-Type": "application/json",
  "Accept": "application/json, text/plain"
});

// Health check
app.get("/health", (req, res) => res.json({ ok: true }));

// Main flow: create -> responses -> submit -> review
app.post("/api/run-flow", async (req, res) => {
  const { q1, q2, name } = req.body; // q1/q2 expected "accept"; name is free text
  const respondentName = (name && String(name).trim()) || "Anonymous";
  const result = { input: { q1, q2, name }, steps: [] };

  try {
    // Step 1: Create assessment (matches WordPress schema)
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

    // OneTrust often returns 201 with the GUID string body; handle both GUID and JSON
    let assessmentId = null;
    try {
      const parsed = JSON.parse(createText);
      assessmentId = parsed.assessmentId || parsed.id || null;
    } catch {
      const guidMatch = createText.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
      if (guidMatch) assessmentId = guidMatch[0];
    }

    result.steps.push({ step: "create", status: createResp.status, assessmentId, raw: createText });

    if (!assessmentId) {
      return res.json({ error: "No assessmentId", result });
    }

    // Normalize webform values:
    // - Multi-choice questions: map "accept" to "I agree" + correct responseId
    // - Text question: use `respondentName` directly as the response text
    const agreeText = "I agree";
    const q1Text = String(q1 || "").toLowerCase() === "accept" ? agreeText : (q1 || "");
    const q2Text = String(q2 || "").toLowerCase() === "accept" ? agreeText : (q2 || "");
    const q3Text = respondentName;

    // Step 2: Save responses (array-of-objects shape you provided)
    const responsesBody = [
      {
        assessmentId,
        questionId: OT_QUESTION_ID1,
        sectionId: OT_SECTION_ID,
        responses: [
          { response: q1Text, responseId: OT_RESPONSE_ID1 }
        ]
      },
      {
        assessmentId,
        questionId: OT_QUESTION_ID2,
        sectionId: OT_SECTION_ID,
        responses: [
          { response: q2Text, responseId: OT_RESPONSE_ID2 }
        ]
      },
      {
        assessmentId,
        questionId: OT_QUESTION_ID3,
        sectionId: OT_SECTION_ID,
        responses: [
          // If your tenant requires responseId for text, set OT_RESPONSE_ID3; else omit or set null
          ...(OT_RESPONSE_ID3
            ? [{ response: q3Text, responseId: OT_RESPONSE_ID3 }]
            : [{ response: q3Text }])
        ]
      }
    ];

    const respSave = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/responses`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(responsesBody)
    });
    const respText = await respSave.text();
    console.log("Responses response raw:", respText);
    result.steps.push({ step: "responses", status: respSave.status, body: respText });

    if (respSave.status < 200 || respSave.status >= 300) {
      return res.json({ error: "Responses not saved", assessmentId, result });
    }

    // Step 3: Submit assessment
    const submitResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/submit`, {
      method: "POST", headers: otHeaders()
    });
    const submitText = await submitResp.text();
    console.log("Submit response raw:", submitText);
    result.steps.push({ step: "submit", status: submitResp.status, body: submitText });

    if (submitResp.status < 200 || submitResp.status >= 300) {
      return res.json({ error: "Submit failed", assessmentId, result });
    }

    // Step 4: Review (complete) assessment
    const reviewBody = {
      assessmentId,
      resultId: OT_RESULT_ID,
      reviewStatus: "Completed"
    };

    const reviewResp = await fetch(`${OT_TENANT_BASE_URL}/api/assessment/v2/assessments/${assessmentId}/reviews`, {
      method: "POST", headers: otHeaders(), body: JSON.stringify(reviewBody)
    });
    const reviewText = await reviewResp.text();
    console.log("Review response raw:", reviewText);
    result.steps.push({ step: "review", status: reviewResp.status, body: reviewText });

    if (reviewResp.status < 200 || reviewResp.status >= 300) {
      return res.json({ error: "Review failed", assessmentId, result });
    }

    // Final response
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
