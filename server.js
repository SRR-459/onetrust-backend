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

// Capture raw text for debugging
const createText = await createResp.text();
console.log("Create response raw:", createText);

let createData;
try {
  createData = JSON.parse(createText);
} catch {
  createData = { raw: createText };
}

const assessmentId = createData.assessmentId;
result.steps.push({ step: "create", status: createResp.status, assessmentId, error: createData });
