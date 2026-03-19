import {type FormEvent, useEffect, useState} from 'react'
import Navbar from "~/components/Navbar";
import FileUploader from "~/components/FileUploader";
import {usePuterStore} from "~/lib/puter";
import {useNavigate} from "react-router";
import {convertPdfToImage} from "~/lib/pdf2img";
import {generateUUID} from "~/lib/utils";
import {prepareInstructions} from "../../constants";

function extractJsonObject(text: string): string | null {
    // Common cases: wrapped in ```json ... ``` or has leading explanation text.
    const cleaned = text
        .replace(/```json/gi, "```")
        .replace(/```/g, "")
        .trim();

    const first = cleaned.indexOf("{");
    const last = cleaned.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) return null;
    return cleaned.slice(first, last + 1);
}

function getAIResponseText(resp: any): string {
    if (!resp) return "";
    if (typeof resp === "string") return resp;

    // Puter can return { text: "..." } in some modes.
    if (typeof resp.text === "string") return resp.text;

    // Our current typing expects { message: { content } }
    const content = resp?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        // common shapes: [{text: "..."}] or [{ type: "text", text: "..." }]
        const firstText =
            content.find((p: any) => typeof p?.text === "string")?.text ??
            content[0]?.text;
        if (typeof firstText === "string") return firstText;
        // fallback: join any string-ish fields
        return content
            .map((p: any) => (typeof p === "string" ? p : p?.text))
            .filter((x: any) => typeof x === "string")
            .join("\n");
    }

    // Last resort
    try {
        return JSON.stringify(resp);
    } catch {
        return String(resp);
    }
}

const Upload = () => {
    const { auth, isLoading, fs, ai, kv, puterReady, error } = usePuterStore();
    const navigate = useNavigate();
    const [isProcessing, setIsProcessing] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [file, setFile] = useState<File | null>(null);

    useEffect(() => {
        // Keep behavior consistent with Home/Resume routes: require auth.
        if(!isLoading && !auth.isAuthenticated) navigate('/auth?next=/upload');
    }, [isLoading, auth.isAuthenticated, navigate]);

    const handleFileSelect = (file: File | null) => {
        setFile(file)
    }

    const handleAnalyze = async ({ companyName, jobTitle, jobDescription, file }: { companyName: string, jobTitle: string, jobDescription: string, file: File  }) => {
        if (!puterReady) {
            setIsProcessing(true);
            return setStatusText('Waiting for Puter.js to load...');
        }
        if (error) {
            setIsProcessing(true);
            return setStatusText(`Error: ${error}`);
        }
        if (!auth.isAuthenticated) {
            return navigate('/auth?next=/upload');
        }

        setIsProcessing(true);

        try {
            setStatusText('Uploading the file...');
            const uploadedFile = await fs.upload([file]);
            if(!uploadedFile) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to upload file');
            }

            setStatusText('Converting to image...');
            const imageFile = await convertPdfToImage(file);
            if(!imageFile.file) {
                setIsProcessing(false);
                return setStatusText(imageFile.error || 'Error: Failed to convert PDF to image');
            }

            setStatusText('Uploading the image...');
            const uploadedImage = await fs.upload([imageFile.file]);
            if(!uploadedImage) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to upload image');
            }

            setStatusText('Preparing data...');
            const uuid = generateUUID();
            const data = {
                id: uuid,
                resumePath: uploadedFile.path,
                imagePath: uploadedImage.path,
                companyName, jobTitle, jobDescription,
                feedback: '',
            }
            const preSaveOk = await kv.set(`resume:${uuid}`, JSON.stringify(data));
            if (!preSaveOk) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to save resume data (kv.set failed)');
            }

            setStatusText('Analyzing...');

            const feedback = await ai.feedback(
                uploadedFile.path,
                prepareInstructions({ jobTitle, jobDescription })
            )
            if (!feedback) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to analyze resume');
            }

            const feedbackText = getAIResponseText(feedback);

            try {
                const jsonCandidate = extractJsonObject(feedbackText) ?? feedbackText;
                data.feedback = JSON.parse(jsonCandidate);
            } catch {
                // One automatic retry with a stricter prompt (common fix for models returning prose/markdown).
                setStatusText('AI response format issue — retrying...');

                const retry = await ai.feedback(
                    uploadedFile.path,
                    prepareInstructions({ jobTitle, jobDescription }) +
                    "\n\nIMPORTANT: Return ONLY valid JSON. No markdown, no code fences, no extra text."
                );

                if (!retry) {
                    setIsProcessing(false);
                    return setStatusText('Error: Failed to analyze resume (retry failed)');
                }

                const retryText = getAIResponseText(retry);

                try {
                    const jsonCandidate = extractJsonObject(retryText) ?? retryText;
                    data.feedback = JSON.parse(jsonCandidate);
                } catch {
                    // Save raw response for debugging and show a friendly message.
                    (data as any).rawFeedback = retryText;
                    setIsProcessing(false);
                    return setStatusText('Error: AI is not returning valid JSON. Please try again with a shorter job description.');
                }
            }
            const saveOk = await kv.set(`resume:${uuid}`, JSON.stringify(data));
            if (!saveOk) {
                setIsProcessing(false);
                return setStatusText('Error: Failed to save review results (kv.set failed)');
            }
            setStatusText('Analysis complete, redirecting...');
            console.log(data);
            navigate(`/resume/${uuid}`);
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            setIsProcessing(false);
            setStatusText(`Error: ${msg}`);
        }
    }

    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        const form = e.currentTarget.closest('form');
        if(!form) return;
        const formData = new FormData(form);

        const companyName = formData.get('company-name') as string;
        const jobTitle = formData.get('job-title') as string;
        const jobDescription = formData.get('job-description') as string;

        if(!file) return;

        handleAnalyze({ companyName, jobTitle, jobDescription, file });
    }

    return (
        <main className="bg-[url('/images/bg-main.svg')] bg-cover">
            <Navbar />

            <section className="main-section">
                <div className="page-heading py-16">
                    <h1>Smart feedback for your dream job</h1>
                    {isProcessing ? (
                        <>
                            <h2>{statusText}</h2>
                            <img src="/images/resume-scan.gif" className="w-full" />
                        </>
                    ) : (
                        <h2>Drop your resume for an ATS score and improvement tips</h2>
                    )}
                    {!isProcessing && (
                        <form id="upload-form" onSubmit={handleSubmit} className="flex flex-col gap-4 mt-8">
                            <div className="form-div">
                                <label htmlFor="company-name">Company Name</label>
                                <input type="text" name="company-name" placeholder="Company Name" id="company-name" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-title">Job Title</label>
                                <input type="text" name="job-title" placeholder="Job Title" id="job-title" />
                            </div>
                            <div className="form-div">
                                <label htmlFor="job-description">Job Description</label>
                                <textarea rows={5} name="job-description" placeholder="Job Description" id="job-description" />
                            </div>

                            <div className="form-div">
                                <label htmlFor="uploader">Upload Resume</label>
                                <FileUploader onFileSelect={handleFileSelect} />
                            </div>

                            <button className="primary-button" type="submit">
                                Analyze Resume
                            </button>
                        </form>
                    )}
                </div>
            </section>
        </main>
    )
}
export default Upload
