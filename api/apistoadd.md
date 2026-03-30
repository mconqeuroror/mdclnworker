# Sora2 - Pro Image to Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Sora2 - Pro Image to Video
      deprecated: false
      description: >-
        Transform images into dynamic videos powered by
        Sora-2-pro-image-to-video's advanced AI model


        ## Character Animation Integration


        For enhanced character animation capabilities, you can use the
        `character_id_list` parameter to reference pre-animated characters:


        <Card title="Sora2 - Characters" href="/market/sora2/sora-2-characters">
           Learn how to create character animations and get character_id_list for integration
        </Card>


        The `character_id_list` parameter is optional and allows you to
        incorporate multiple character animations (as an array, maximum 5) into
        your pro image-to-video generation.


        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
           Learn how to query task status and retrieve generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Explore all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check credits and account usage
          </Card>
        </CardGroup>
      operationId: sora-2-pro-image-to-video
      tags:
        - docs/en/Market/Video Models/Sora2
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - sora-2-pro-image-to-video
                  default: sora-2-pro-image-to-video
                  description: |-
                    The model name to use for generation. Required field.

                    - Must be `sora-2-pro-image-to-video` for this endpoint
                  examples:
                    - sora-2-pro-image-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                progressCallBackUrl:
                  type: string
                  description: >-
                    User progress callback address

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  format: uri
                  examples:
                    - https://your-domain.com/api/v1/jobs/progressCallBackUrl
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      description: >-
                        The text prompt describing the desired video motion (Max
                        length: 10000 characters)
                      type: string
                      maxLength: 10000
                      examples:
                        - ''
                    image_urls:
                      description: >-
                        URL of the image to use as the first frame. Must be
                        publicly accessible (File URL after upload, not file
                        content; Accepted types: image/jpeg, image/png,
                        image/webp; Max size: 10.0MB)
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 1
                      examples:
                        - []
                    aspect_ratio:
                      description: This parameter defines the aspect ratio of the image.
                      type: string
                      enum:
                        - portrait
                        - landscape
                      default: landscape
                      examples:
                        - landscape
                    n_frames:
                      description: The number of frames to be generated.
                      type: string
                      enum:
                        - '10'
                        - '15'
                      default: '10'
                      examples:
                        - '10'
                    size:
                      description: The quality or size of the generated image.
                      type: string
                      enum:
                        - standard
                        - high
                      default: standard
                      examples:
                        - standard
                    remove_watermark:
                      description: >-
                        When enabled, removes watermarks from the generated
                        video. (Boolean value (true/false))
                      type: boolean
                      examples:
                        - true
                    character_id_list:
                      description: >-
                        Optional array of character IDs from Sora-2-characters
                        model to incorporate character animations into the video
                        generation. Maximum 5 character IDs allowed. Leave empty
                        if not using character animations.
                      type: array
                      items:
                        type: string
                      maxItems: 5
                      examples:
                        - - example_123456789
                          - example_987654321
                    upload_method:
                      type: string
                      description: >-
                        Upload destination. Defaults to s3; choose oss for
                        Aliyun storage (better access within China).
                      enum:
                        - oss
                        - s3
                      x-apidog-enum:
                        - value: oss
                          name: ''
                          description: ''
                        - value: s3
                          name: ''
                          description: ''
                      default: s3
                  required:
                    - prompt
                    - image_urls
                    - upload_method
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - aspect_ratio
                    - n_frames
                    - size
                    - remove_watermark
                    - character_id_list
                    - upload_method
                    - 01KH0FF8M78NHA5MW6PRWPAKCG
                  x-apidog-refs:
                    01KH0FF8M78NHA5MW6PRWPAKCG:
                      type: object
                      properties: {}
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - progressCallBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: sora-2-pro-image-to-video
              callBackUrl: https://your-domain.com/api/callback
              progressCallBackUrl: https://your-domain.com/api/v1/jobs/progressCallBackUrl
              input:
                prompt: ''
                image_urls: []
                aspect_ratio: landscape
                n_frames: '10'
                size: standard
                remove_watermark: true
                upload_method: s3
                character_id_list:
                  - example_123456789
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_sora-2-pro-image-to-video_1765183474472
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Sora2
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506411-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```

# Sora2 - Pro Text to Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Sora2 - Pro Text to Video
      deprecated: false
      description: >-
        High-quality video generation from text descriptions powered by
        Sora-2-pro-text-to-video's advanced AI model


        ## Character Animation Integration


        For enhanced character animation capabilities, you can use the
        `character_id_list` parameter to reference pre-animated characters:


        <Card title="Sora2 - Characters" href="/market/sora2/sora-2-characters">
           Learn how to create character animations and get character_id_list for integration
        </Card>


        The `character_id_list` parameter is optional and allows you to
        incorporate multiple character animations (as an array, maximum 5) into
        your pro text-to-video generation.


        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
           Learn how to query task status and retrieve generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Explore all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check credits and account usage
          </Card>
        </CardGroup>
      operationId: sora-2-pro-text-to-video
      tags:
        - docs/en/Market/Video Models/Sora2
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - sora-2-pro-text-to-video
                  default: sora-2-pro-text-to-video
                  description: |-
                    The model name to use for generation. Required field.

                    - Must be `sora-2-pro-text-to-video` for this endpoint
                  examples:
                    - sora-2-pro-text-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                progressCallBackUrl:
                  type: string
                  description: >-
                    User progress callback address

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  format: uri
                  examples:
                    - https://your-domain.com/api/v1/jobs/progressCallBackUrl
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      description: >-
                        The text prompt describing the desired video motion (Max
                        length: 10000 characters)
                      type: string
                      maxLength: 10000
                      examples:
                        - a happy dog running in the garden
                    aspect_ratio:
                      description: This parameter defines the aspect ratio of the image.
                      type: string
                      enum:
                        - portrait
                        - landscape
                      default: landscape
                      examples:
                        - landscape
                    n_frames:
                      description: The number of frames to be generated.
                      type: string
                      enum:
                        - '10'
                        - '15'
                      default: '10'
                      examples:
                        - '10'
                    size:
                      description: The quality or size of the generated image.
                      type: string
                      enum:
                        - standard
                        - high
                      default: high
                      examples:
                        - high
                    remove_watermark:
                      description: >-
                        When enabled, removes watermarks from the generated
                        video. (Boolean value (true/false))
                      type: boolean
                      examples:
                        - true
                    character_id_list:
                      description: >-
                        Optional array of character IDs from Sora-2-characters
                        model to incorporate character animations into the video
                        generation. Maximum 5 character IDs allowed. Leave empty
                        if not using character animations.
                      type: array
                      items:
                        type: string
                      maxItems: 5
                      examples:
                        - - example_123456789
                          - example_987654321
                    upload_method:
                      type: string
                      description: >-
                        Upload destination. Defaults to s3; choose oss for
                        Aliyun storage (better access within China).
                      enum:
                        - s3
                        - oss
                      x-apidog-enum:
                        - value: s3
                          name: ''
                          description: ''
                        - value: oss
                          name: ''
                          description: ''
                      default: s3
                  required:
                    - prompt
                    - upload_method
                  x-apidog-orders:
                    - prompt
                    - aspect_ratio
                    - n_frames
                    - size
                    - remove_watermark
                    - character_id_list
                    - upload_method
                    - 01KH0FFQCX0SGEAB3F4G2G0BHW
                  x-apidog-refs:
                    01KH0FFQCX0SGEAB3F4G2G0BHW:
                      type: object
                      properties: {}
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - progressCallBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: sora-2-pro-text-to-video
              callBackUrl: https://your-domain.com/api/callback
              progressCallBackUrl: https://your-domain.com/api/v1/jobs/progressCallBackUrl
              input:
                prompt: a happy dog running in the garden
                aspect_ratio: landscape
                n_frames: '10'
                size: high
                remove_watermark: true
                upload_method: s3
                character_id_list:
                  - example_123456789
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_sora-2-pro-text-to-video_1765183463848
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Sora2
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506412-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Kling 3.0

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Kling 3.0
      deprecated: false
      description: >-
        Generate high-quality videos with advanced multi-shot capabilities and
        element references using Kling 3.0 AI 


        ## Overview


        Kling 3.0 is an advanced video generation model that supports both
        single-shot and multi-shot video creation with element references. It
        offers two generation modes (standard and pro) with different resolution
        options, and supports sound effects for enhanced video output.


        ## Key Features


        - **Dual Generation Modes**: Choose between `std` (standard resolution)
        and `pro` (higher resolution) modes

        - **Multi-Shot Support**: Create videos with multiple shots, each with
        its own prompt and duration

        - **Element References**: Reference images in your prompts using
        `@element_name` syntax

        - **Sound Effects**: Optional sound effects to enhance video output

        - **Flexible Aspect Ratios**: Support for 16:9, 9:16, and 1:1 aspect
        ratios

        - **Configurable Duration**: Video duration from 3 to 15 seconds


        ## Resolution Mappings


        The resolution depends on both the `mode` and `aspect_ratio` parameters:


        <Tabs groupId="mode">

        <TabItem value="std" label="Standard Mode (std)">


        | Aspect Ratio | Resolution |

        |--------------|------------|

        | 16:9         | 1280×720   |

        | 9:16         | 720×1280   |

        | 1:1          | 720×720    |


        </TabItem>

        <TabItem value="pro" label="Pro Mode (pro)">


        | Aspect Ratio | Resolution |

        |--------------|------------|

        | 16:9         | 1920×1080  |

        | 9:16         | 1080×1920  |

        | 1:1          | 1080×1080  |


        </TabItem>

        </Tabs>


        :::info[]

        Pro mode provides higher resolution output but may take longer to
        generate and consume more credits.

        :::


        ## Single-Shot vs Multi-Shot Mode


        ### Single-Shot Mode (`multi_shots: false`)

        - Uses the main `prompt` field for video generation

        - Supports first and last frame images via `image_urls`

        - Sound effects are optional


        ### Multi-Shot Mode (`multi_shots: true`)

        - Uses `multi_prompt` array to define multiple shots

        - Each shot has its own prompt and duration (1-12 seconds)

        - Only supports first frame image (via `image_urls[0]`)

        - Sound effects default to enabled

        - The maximum number of characters per shot is 500



        ## Aspect Ratio Auto-Adaptation


        When you provide `image_urls` (first and/or last frame images), the
        `aspect_ratio` parameter becomes optional. The system will automatically
        adapt the aspect ratio based on the uploaded images, so you don't need
        to specify it manually.


        :::tip[]

        If you upload reference images, you can omit the `aspect_ratio`
        parameter and let the system automatically match the aspect ratio of
        your images.

        :::


        ## Element References


        You can reference images or videos in your prompts using the
        `@element_name` syntax. Define elements in the `kling_elements` array:


        - **Image Elements**: 2-4 image URLs (JPG/PNG, max 10MB each)


        :::tip[]

        Use descriptive element names and ensure the element name in
        `kling_elements` matches the name used in your prompt (without the @
        symbol).

        A single task can reference a maximum of 3 elements, and each `@element`
        will occupy 37 characters.

        :::


        ## File Upload Requirements


        Before using element references, upload your image  files:


        ### 1. Upload Files


        Use the File Upload API to upload your source images.


        :::info[File Upload API]

        Learn how to upload files and get file URLs: [File Upload API
        Quickstart](/file-upload-api/quickstart)

        :::


        ### 2. Get File URLs


        After upload, you'll receive file URLs that you can use in
        `element_input_urls` .


        :::caution[]

        - Image formats: JPG, PNG (max 10MB per file, 2-4 files per element)

        - Ensure file URLs are accessible and not expired

        :::


        ## Usage Examples


        ### Single-Shot Video with Element Reference


        ```json

        {
          "model": "kling-3.0",
          "input": {
            "prompt": "In a bright rehearsal room, sunlight streams through the window@element_dog",
            "image_urls": [
              "https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"
            ],
            "sound": true,
            "duration": "5",
            "aspect_ratio": "16:9",
            "mode": "pro",
            "multi_shots": false,
            "kling_elements": [
              {
                "name": "element_dog",
                "description": "dog",
                "element_input_urls": [
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg",
                  "https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png"
                ]
              }
            ]
          }
        }

        ```


        ### Multi-Shot Video


        ```json

        {
          "model": "kling-3.0",
          "input": {
            "multi_shots": true,
            "image_urls": [
              "https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png"
            ],
            "duration": "5",
            "aspect_ratio": "16:9",
            "mode": "pro",
            "multi_prompt": [
              {
                "prompt": "a happy dog in running@element_cat",
                "duration": 3
              },
              {
                "prompt": "a happy dog play with a cat@element_dog",
                "duration": 3
              }
            ],
            "kling_elements": [
              {
                "name": "element_cat",
                "description": "cat",
                "element_input_urls": [ "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg",    "https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png"
                ]
              },
              {
                "name": "element_dog",
                "description": "dog",
                "element_input_urls": [ "https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg",    "https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png"
                ]
              }
            ]
          }
        }

        ```


        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        :::tip[Get Task Details]

        Learn how to query task status and retrieve generation results: [Get
        Task Details](/market/common/get-task-detail)

        :::


        :::tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Best Practices


        - **Prompt Writing**: Be specific and descriptive in your prompts.
        Include details about motion, camera angles, and scene composition

        - **Element Usage**: Use high-quality reference images/videos for better
        results. Ensure elements match the style and theme of your video

        - **Duration Planning**: For multi-shot videos, plan your shot durations
        to match the total video duration

        - **Mode Selection**: Use `pro` mode for final output when quality is
        important, and `std` mode for faster iterations

        - **Sound Effects**: Enable sound effects for more immersive videos,
        especially for action or dynamic scenes


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
          </Card>
        </CardGroup>
      operationId: kling-3.0
      tags:
        - docs/en/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - kling-3.0/video
                  default: kling-3.0/video
                  description: >-
                    Generation mode. std has standard resolution, pro has higher
                    resolution.
                  examples:
                    - kling-3.0/video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      type: string
                      description: >-
                        Video generation prompt. Takes effect when multi_shots
                        is false.
                      examples:
                        - >-
                          In a bright rehearsal room, sunlight streams through
                          the window@element_dog
                    image_urls:
                      type: array
                      items:
                        type: string
                        format: uri
                      description: >-
                        First and last frame image URLs. Required when elements
                        are referenced in the prompt (using @element_name
                        syntax). When multi_shots is false: if length is 2,
                        index 0 is the first frame and index 1 is the last
                        frame; if length is 1, the array item serves as the
                        first frame. When multi_shots is true: only the first
                        frame is supported.
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                    sound:
                      type: boolean
                      description: >-
                        Whether to enable sound effects. true enables sound
                        effects, false disables them. When multi_shots is true,
                        this field defaults to true.
                      default: false
                      examples:
                        - true
                    duration:
                      type: string
                      description: >-
                        Total video duration in seconds. Integer value, range: 3
                        to 15.
                      enum:
                        - '3'
                        - '4'
                        - '5'
                        - '6'
                        - '7'
                        - '8'
                        - '9'
                        - '10'
                        - '11'
                        - '12'
                        - '13'
                        - '14'
                        - '15'
                      default: '5'
                      examples:
                        - '5'
                    aspect_ratio:
                      type: string
                      description: >-
                        Video aspect ratio. Options: 16:9, 9:16, 1:1. When
                        image_urls(first and last frame images) is provided,
                        this parameter is optional and the aspect ratio will be
                        automatically adapted based on the uploaded images.
                      enum:
                        - '16:9'
                        - '9:16'
                        - '1:1'
                      default: '16:9'
                      examples:
                        - '16:9'
                    mode:
                      type: string
                      description: >-
                        Generation mode. std has standard resolution, pro has
                        higher resolution.


                        Resolution mapping:

                        - **std mode**: 16:9 (1280×720), 9:16 (720×1280), 1:1
                        (720×720)

                        - **pro mode**: 16:9 (1920×1080), 9:16 (1080×1920), 1:1
                        (1080×1080)
                      enum:
                        - std
                        - pro
                      default: pro
                      examples:
                        - pro
                    multi_shots:
                      type: boolean
                      description: >-
                        Whether to use multi-shot mode. true enables multi-shot
                        mode, false enables single-shot mode.
                      default: false
                      examples:
                        - false
                    multi_prompt:
                      type: array
                      description: >-
                        Shot prompts. Takes effect when multi_shots is true.
                        Used to describe the text and duration of each shot.
                        Supports up to 5 shots. Each shot duration is 1-12
                        seconds. If you need to use elements, add them after the
                        prompt.
                      items:
                        type: object
                        properties:
                          prompt:
                            type: string
                            description: >-
                              Prompt text for this shot, a maximum of 500
                              characters per shot. Each @element will occupy 37
                              characters.
                            examples:
                              - a happy dog in running@element_cat
                            maxLength: 500
                          duration:
                            type: integer
                            description: 'Duration of this shot in seconds. Range: 1-12.'
                            minimum: 1
                            maximum: 12
                            examples:
                              - 3
                        required:
                          - prompt
                          - duration
                        x-apidog-orders:
                          - prompt
                          - duration
                        x-apidog-ignore-properties: []
                      examples:
                        - - prompt: a happy dog in running@element_cat
                            duration: 3
                          - prompt: a happy dog play with a cat@element_dog
                            duration: 3
                    kling_elements:
                      type: array
                      items:
                        type: object
                        properties:
                          name:
                            type: string
                            description: >-
                              Element name, used in prompt with @ prefix (e.g.,
                              @element_dog)
                            examples:
                              - element_dog
                          description:
                            type: string
                            description: Element description
                            examples:
                              - dog
                          element_input_urls:
                            type: array
                            items:
                              type: string
                              format: uri
                            description: >-
                              Image URLs for the element. 2-4 URLs required.
                              Accepted formats: JPG, PNG. Maximum file size:
                              10MB per image.
                            examples:
                              - - >-
                                  https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                                - >-
                                  https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                        required:
                          - name
                          - description
                        x-apidog-orders:
                          - name
                          - description
                          - element_input_urls
                        x-apidog-ignore-properties: []
                      description: >-
                        Referenced elements. Detailed information about elements
                        referenced in the prompt. A single task can reference a
                        maximum of three elements.
                      examples:
                        - - name: element_dog
                            description: dog
                            element_input_urls:
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                              - >-
                                https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                      maxItems: 3
                  required:
                    - prompt
                    - sound
                    - duration
                    - aspect_ratio
                    - mode
                    - multi_shots
                    - multi_prompt
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - sound
                    - duration
                    - aspect_ratio
                    - mode
                    - multi_shots
                    - multi_prompt
                    - kling_elements
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling-3.0/video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  In a bright rehearsal room, sunlight streams through the
                  window@element_dog
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                sound: true
                duration: '5'
                aspect_ratio: '16:9'
                mode: pro
                multi_shots: false
                multi_prompt:
                  - prompt: a happy dog in running@element_cat
                    duration: 3
                  - prompt: a happy dog play with a cat@element_dog
                    duration: 3
                kling_elements:
                  - name: element_dog
                    description: dog
                    element_input_urls:
                      - >-
                        https://tempfileb.aiquickdraw.com/kieai/market/1770361808044_4RfUUJrI.jpeg
                      - >-
                        https://tempfileb.aiquickdraw.com/kieai/market/1770361848336_ABQqRHBi.png
                  - name: element_cat
                    description: cat
                    element_input_urls:
                      - https://your-cdn.com/element_image.jpg
                      - https://your-cdn.com/element_image2.jpg
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - type: object
                    properties: {}
                  - type: object
                    properties:
                      data:
                        type: object
                        properties:
                          taskId:
                            type: string
                            description: >-
                              Task ID, can be used with Get Task Details
                              endpoint to query task status
                            examples:
                              - task_kling-3.0_1765187774173
                        x-apidog-orders:
                          - taskId
                        x-apidog-ignore-properties: []
                    x-apidog-orders:
                      - data
                    x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling-3.0_1765187774173
          headers: {}
          x-apidog-name: ''
        '500':
          description: 请求失败
          content:
            application/json:
              schema:
                type: object
                properties: {}
                x-apidog-orders: []
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: Error
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506394-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Generate Veo3.1 Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/veo/generate:
    post:
      summary: Generate Veo3.1 Video
      deprecated: false
      description: >-
        ::: info[]

        Create a new video generation task using the Veo3.1 AI model.

        :::

        Our **Veo 3.1 Generation API** is more than a direct wrapper around
        Google's baseline. It layers extensive optimisation and reliability
        tooling on top of the official models, giving you greater flexibility
        and markedly higher success rates — **25% of the official Google
        pricing** (see [kie.ai/pricing](https://kie.ai/pricing) for full
        details).


        | Capability           | Details |

        | :------------------- | :------ |

        | **Models**           | • **Veo 3.1 Quality** — flagship model, highest
        fidelity<br />• **Veo 3.1 Fast** — cost-efficient variant that still
        delivers strong visual results |

        | **Tasks**            | • **Text → Video**<br />• **Image → Video**
        (single reference frame or first and last frames)<br />• **Material →
        Video** (based on material images) |

        | **Generation Modes** | • **TEXT\_2\_VIDEO** — Text-to-video: using
        text prompts only<br />• **FIRST\_AND\_LAST\_FRAMES\_2\_VIDEO** — First
        and last frames to video: generate transition videos using one or two
        images<br />• **REFERENCE\_2\_VIDEO** — Material-to-video: based on
        material images (**Fast model only**, supports **16:9 & 9:16**) |

        | **Aspect Ratios**    | Supports both native **16:9** and **9:16**
        outputs. **Auto** mode lets the system decide aspect ratio based on
        input materials and internal strategy (for production control, we
        recommend explicitly setting `aspect_ratio`). |

        | **Output Quality**   | Both **16:9** and **9:16** support **1080P**
        and **4K** outputs. **4K requires extra credits** (approximately **2×
        the credits of generating a Fast mode video**) and is requested via a
        separate 4K endpoint. |

        | **Audio Track**      | All videos ship with background audio by
        default. In rare cases, upstream may suppress audio when the scene is
        deemed sensitive (e.g. minors). |


        ### Why our Veo 3.1 API is different


        1. **True vertical video** – Native Veo 3.1 supports **9:16** output,
        delivering authentic vertical videos without the need for re-framing or
        manual editing.

        2. **Global language reach** – Our flow supports multilingual prompts by
        default (no extra configuration required).

        3. **Significant cost savings** – Our rates are 25% of Google's direct
        API pricing.
      operationId: generate-veo3-1-video
      tags:
        - docs/en/Market/Veo3.1 API
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: >-
                    Text prompt describing the desired video content. Required
                    for all generation modes.


                    - Should be detailed and specific in describing video
                    content

                    - Can include actions, scenes, style and other information

                    - For image-to-video, describe how you want the image to
                    come alive
                  examples:
                    - A dog playing in a park
                imageUrls:
                  type: array
                  items:
                    type: string
                  description: >-
                    Image URL list (used in image-to-video mode). Supports 1 or
                    2 images:


                    - **1 image**: The generated video will unfold around this
                    image, with the image content presented dynamically

                    - **2 images**: The first image serves as the video's first
                    frame, and the second image serves as the video's last
                    frame, with the video transitioning between them

                    - Must be valid image URLs

                    - Images must be accessible to the API server.
                  examples:
                    - - http://example.com/image1.jpg
                      - http://example.com/image2.jpg
                model:
                  type: string
                  description: >-
                    Select the model type to use.


                    - veo3: Veo 3.1 Quality, supports both text-to-video and
                    image-to-video generation

                    - veo3_fast: Veo3.1 Fast generation model, supports both
                    text-to-video and image-to-video generation
                  enum:
                    - veo3
                    - veo3_fast
                  default: veo3_fast
                  examples:
                    - veo3_fast
                generationType:
                  type: string
                  description: >-
                    Video generation mode (optional). Specifies different video
                    generation approaches:


                    - **TEXT_2_VIDEO**: Text-to-video - Generate videos using
                    only text prompts

                    - **FIRST_AND_LAST_FRAMES_2_VIDEO**: First and last frames
                    to video - Flexible image-to-video generation mode
                      - 1 image: Generate video based on the provided image
                      - 2 images: First image as first frame, second image as last frame, generating transition video
                    - **REFERENCE_2_VIDEO**: Reference-to-video - Generate
                    videos based on reference images, requires 1-3 images in
                    imageUrls (minimum 1, maximum 3)


                    **Important Notes**:

                    - REFERENCE_2_VIDEO mode currently only supports veo3_fast
                    model

                    - If not specified, the system will automatically determine
                    the generation mode based on whether imageUrls are provided
                  enum:
                    - TEXT_2_VIDEO
                    - FIRST_AND_LAST_FRAMES_2_VIDEO
                    - REFERENCE_2_VIDEO
                  examples:
                    - TEXT_2_VIDEO
                aspect_ratio:
                  type: string
                  description: >-
                    Video aspect ratio. Specifies the dimension ratio of the
                    generated video. Available options:


                    - 16:9: Landscape video format. 

                    - 9:16: Portrait video format, suitable for mobile short
                    videos

                    - Auto: In auto mode, the video will be automatically
                    center-cropped based on whether your uploaded image is
                    closer to 16:9 or 9:16.


                    Default value is 16:9.
                  enum:
                    - '16:9'
                    - '9:16'
                    - Auto
                  default: '16:9'
                  examples:
                    - '16:9'
                seeds:
                  type: integer
                  description: >-
                    (Optional) Random seed parameter to control the randomness
                    of the generated content. Value range: 10000-99999. The same
                    seed will generate similar video content, different seeds
                    will generate different content. If not provided, the system
                    will assign one automatically.
                  minimum: 10000
                  maximum: 99999
                  examples:
                    - 12345
                callBackUrl:
                  type: string
                  description: >-
                    Completion callback URL for receiving video generation
                    status updates.


                    - Optional but recommended for production use

                    - System will POST task completion status to this URL when
                    the video generation is completed

                    - Callback will include task results, video URLs, and status
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload

                    - For detailed callback format and implementation guide, see
                    [Callback
                    Documentation](https://docs.kie.ai/veo3-api/generate-veo-3-video-callbacks)

                    - Alternatively, use the Get Video Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - http://your-callback-url.com/complete
                enableFallback:
                  type: boolean
                  description: >-
                    Deprecated Enable fallback functionality. When set to true,
                    if the official Veo3.1 video generation service is
                    unavailable or encounters exceptions, the system will
                    automatically switch to a backup model for video generation
                    to ensure task continuity and reliability. Default value is
                    false.


                    - When fallback is enabled, backup model will be used for
                    the following errors:
                      - public error minor upload
                      - Your prompt was flagged by Website as violating content policies
                      - public error prominent people upload
                    - Fallback mode requires 16:9 aspect ratio and uses 1080p
                    resolution by default

                    - **Note**: Videos generated through fallback mode cannot be
                    accessed via the Get 1080P Video endpoint

                    - **Credit Consumption**: Successful fallback has different
                    credit consumption, please see https://kie.ai/pricing for
                    pricing details


                    **Note: This parameter is deprecated. Please remove this
                    parameter from your requests. The system has automatically
                    optimized the content review mechanism without requiring
                    manual fallback configuration.**
                  default: false
                  deprecated: true
                  examples:
                    - false
                enableTranslation:
                  type: boolean
                  description: >-
                    Enable prompt translation to English. When set to true, the
                    system will automatically translate prompts to English
                    before video generation for better generation results.
                    Default value is true.


                    - true: Enable translation, prompts will be automatically
                    translated to English

                    - false: Disable translation, use original prompts directly
                    for generation
                  default: true
                  examples:
                    - true
                watermark:
                  type: string
                  description: >-
                    Watermark text.


                    - Optional parameter

                    - If provided, a watermark will be added to the generated
                    video
                  examples:
                    - MyBrand
              required:
                - prompt
              x-apidog-orders:
                - prompt
                - imageUrls
                - model
                - generationType
                - aspect_ratio
                - seeds
                - callBackUrl
                - enableFallback
                - enableTranslation
                - watermark
              examples:
                - prompt: A dog playing in a park
                  imageUrls:
                    - http://example.com/image1.jpg
                    - http://example.com/image2.jpg
                  model: veo3_fast
                  watermark: MyBrand
                  callBackUrl: http://your-callback-url.com/complete
                  aspect_ratio: '16:9'
                  seeds: 12345
                  enableFallback: false
                  enableTranslation: true
                  generationType: REFERENCE_2_VIDEO
              x-apidog-ignore-properties: []
            example:
              prompt: A dog playing in a park
              imageUrls:
                - http://example.com/image1.jpg
                - http://example.com/image2.jpg
              model: veo3_fast
              watermark: MyBrand
              callBackUrl: http://your-callback-url.com/complete
              aspect_ratio: '16:9'
              seeds: 12345
              enableFallback: false
              enableTranslation: true
              generationType: REFERENCE_2_VIDEO
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    enum:
                      - 200
                      - 400
                      - 401
                      - 402
                      - 404
                      - 422
                      - 429
                      - 455
                      - 500
                      - 501
                      - 505
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **400**: 1080P is processing. It should be ready in 1-2
                      minutes. Please check back shortly.

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - Request parameters failed
                      validation. When fallback is not enabled and generation
                      fails, error message format: Your request was rejected by
                      Flow(original error message). You may consider using our
                      other fallback channels, which are likely to succeed.
                      Please refer to the documentation.

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Video generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Error message when code != 200
                    examples:
                      - success
                  data:
                    type: object
                    properties:
                      taskId:
                        type: string
                        description: >-
                          Task ID, can be used with Get Video Details endpoint
                          to query task status
                        examples:
                          - veo_task_abcdef123456
                    x-apidog-orders:
                      - taskId
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: veo_task_abcdef123456
          headers: {}
          x-apidog-name: success
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      callbacks:
        onVideoGenerated:
          '{$request.body#/callBackUrl}':
            post:
              summary: Video Generation Callback
              description: >-
                When the video generation task is completed, the system will
                send the result to your provided callback URL via POST request
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        code:
                          type: integer
                          description: >-
                            Status code


                            - **200**: Success - Video generation task
                            successfully

                            - **400**: Your prompt was flagged by Website as
                            violating content policies.

                            Only English prompts are supported at this time.

                            Failed to fetch the image. Kindly verify any access
                            limits set by you or your service provider.

                            public error unsafe image upload.

                            - **422**: Fallback failed - When fallback is not
                            enabled and specific errors occur, returns error
                            message format: Your request was rejected by
                            Flow(original error message). You may consider using
                            our other fallback channels, which are likely to
                            succeed. Please refer to the documentation.

                            - **500**: Internal Error, Please try again later.

                            Internal Error - Timeout

                            - **501**: Failed - Video generation task failed
                          enum:
                            - 200
                            - 400
                            - 422
                            - 500
                            - 501
                        msg:
                          type: string
                          description: Status message
                          example: Veo3.1 video generated successfully.
                        data:
                          type: object
                          properties:
                            taskId:
                              type: string
                              description: Task ID
                              example: veo_task_abcdef123456
                            info:
                              type: object
                              properties:
                                resultUrls:
                                  type: string
                                  description: Generated video URLs
                                  example: '[http://example.com/video1.mp4]'
                                originUrls:
                                  type: string
                                  description: >-
                                    Original video URLs. Only has value when
                                    aspect_ratio is not 16:9
                                  example: '[http://example.com/original_video1.mp4]'
                                resolution:
                                  type: string
                                  description: Video resolution information
                                  example: 1080p
                            fallbackFlag:
                              type: boolean
                              description: >-
                                Whether generated using fallback model. True
                                means backup model was used, false means primary
                                model was used
                              example: false
                              deprecated: true
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Veo3.1 API
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506311-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Extend Veo3.1 Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/veo/extend:
    post:
      summary: Extend Veo3.1 Video
      deprecated: false
      description: >
        ::: info[]
          Extend an existing Veo 3.1 video by generating new content based on the original video and a text prompt. This feature allows you to extend video duration or add new content based on your existing video clips.
        :::


        Our **Veo 3.1 Video Extension API** is more than simple video splicing.
        It layers intelligent extension algorithms on top of the official
        models, giving you greater flexibility and markedly higher success rates
        — **25% of the official Google pricing** (see [pricing
        details](https://kie.ai/pricing) for full details).


        | Capability              | Details |

        | :---------------------- | :------ |

        | **Smart Extension**     | Generate new video segments based on
        existing videos and text prompts |

        | **Seamless Connection** | Extended videos naturally connect with the
        original video |

        | **Flexible Control**    | Precisely control the style and actions of
        extended content through prompts |

        | **High-Quality Output** | Maintain the same quality and style as the
        original video |

        | **Audio Track**         | Extended videos default to background audio,
        consistent with the original video |


        ### Why our Veo 3.1 Video Extension is different


        1. **Smart Content Understanding** – Deeply understands the content and
        style of the original video to ensure coherence of extended content.

        2. **Natural Transition** – Extended video segments seamlessly connect
        with the original video without visible splicing marks.

        3. **Flexible Control** – Precisely control the actions, scenes, and
        styles of extended content through detailed prompts.

        4. **Significant Cost Savings** – Our rates are 25% of Google's direct
        API pricing.


        ***


        ### Video Extension Workflow


        The video extension feature is based on your existing Veo3.1 generated
        videos and works through the following steps:


        1. **Provide Original Video**: Use the `taskId` from the original video
        generation task

        2. **Describe Extension Content**: Use `prompt` to detail how you want
        the video to be extended

        3. **Smart Analysis**: The system analyzes the content, style, and
        actions of the original video

        4. **Generate Extension**: Generate new video segments based on analysis
        results and your prompts

        5. **Seamless Connection**: Naturally connect the extended video with
        the original video


        ### Extension Features


        ::: info[Through the video extension feature, you can:]

        - Extend video duration and add more content

        - Change video direction and add new actions or scenes

        - Add new elements while maintaining the original style

        - Create richer video stories

        :::


        **Extension Features:**


        - **Smart Analysis**: Deeply understand the content and style of the
        original video

        - **Natural Connection**: Extended content seamlessly connects with the
        original video

        - **Flexible Control**: Precisely control extended content through
        prompts

        - **Quality Assurance**: Maintain the same quality and style as the
        original video


        ::: warning[**Important Notes**]

        - Can only extend videos generated through the Veo3.1 API

        - Extended content must also comply with platform content policies

        - Recommend using English prompts for best results

        - Video extension consumes credits, see [pricing
        Details](https://kie.ai/pricing) for specific pricing

        :::


        ### Best Practices


        ::: tip[Prompt Writing Suggestions]

        1. **Detailed Action Description**: Clearly describe how you want the
        video to be extended, e.g., "the dog continues running through the park,
        jumping over obstacles"

        2. **Maintain Style Consistency**: Ensure the style of extended content
        matches the original video

        3. **Natural Transition**: Described actions should naturally connect
        with the end of the original video

        4. **Use English**: Recommend using English prompts for best results

        5. **Avoid Conflicts**: Ensure extended content doesn't create logical
        conflicts with the original video

        :::


        ::: tip[Technical Recommendations]

        1. **Use Callbacks**: Strongly recommend using callback mechanisms to
        get results in production environments

        2. **Download Promptly**: Download video files promptly after
        generation, URLs have time limits

        3. **Error Handling**: Implement appropriate error handling and retry
        mechanisms

        4. **Credit Management**: Monitor credit usage to ensure sufficient
        balance

        5. **Seed Control**: Use the seeds parameter to control the randomness
        of generated content

        :::


        ## Important Notes


        ::: warning[Important Limitations]

        - **Original Video Requirements**: Can only extend videos generated
        through the Veo3.1 API

        - **Content Policy**: Extended content must also comply with platform
        content policies

        - **Credit Consumption**: Video extension consumes credits, see [pricing
        Details](https://kie.ai/pricing) for specific pricing

        - **Processing Time**: Video extension may take several minutes to over
        ten minutes to process

        - **URL Validity**: Generated video URLs have time limits, please
        download and save promptly

        :::


        ::: note[Extended Video Features]

        - **Seamless Connection**: Extended videos will naturally connect with
        the original video

        - **Quality Maintenance**: Extended videos maintain the same quality as
        the original video

        - **Style Consistency**: Extended content will maintain the visual style
        of the original video

        - **Flexible Control**: Prompts can precisely control the content and
        direction of extension

        :::


        ## Troubleshooting


        <AccordionGroup>

        <Accordion title="Common Error Handling">

        - **404 Error**: Check if task_id and media_id are correct

        - **400 Error**: Check if the prompt complies with content policies

        - **402 Error**: Confirm the account has sufficient credits

        - **500 Error**: Temporary server issue, please try again later

        </Accordion>


        <Accordion title="Extension Quality Issues">

        - **Unnatural Connection**: Try more detailed prompt descriptions

        - **Style Inconsistency**: Ensure the prompt includes style descriptions

        - **Disconnected Actions**: Check if action descriptions in the prompt
        are reasonable

        - **Content Deviation**: Adjust prompts to more accurately describe
        desired extension content

        </Accordion>


        <Accordion title="Technical Issues">

        - **Callback Receipt Failure**: Check if the callback URL is accessible

        - **Video Download Failure**: Confirm URL validity and network
        connection

        - **Abnormal Task Status**: Use the details query interface to check
        task status

        - **Insufficient Credits**: Recharge credits promptly to continue using
        the service

        </Accordion>

        </AccordionGroup>
      operationId: extend-veo3-1-video
      tags:
        - docs/en/Market/Veo3.1 API
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                taskId:
                  type: string
                  description: >-
                    Task ID of the original video generation. Must be a valid
                    taskId returned from the video generation interface. Note:
                    Videos generated after 1080P generation cannot be extended.
                  examples:
                    - veo_task_abcdef123456
                prompt:
                  type: string
                  description: >-
                    Text prompt describing the extended video content. Should
                    detail how you want the video to be extended, including
                    actions, scene changes, style, etc.
                  examples:
                    - >-
                      The dog continues running through the park, jumping over
                      obstacles and playing with other dogs
                seeds:
                  type: integer
                  description: >-
                    Random seed parameter for controlling the randomness of
                    generated content. Range: 10000-99999. Same seeds will
                    generate similar video content, different seeds will
                    generate different video content. If not specified, the
                    system will automatically assign random seeds.
                  minimum: 10000
                  maximum: 99999
                  examples:
                    - 12345
                model:
                  type: string
                  description: >-
                    Model type for video extension (optional). Defaults to
                    `fast` if not specified.


                    - **fast**: Fast generation mode

                    - **quality**: High quality generation mode
                  enum:
                    - fast
                    - quality
                  default: fast
                  examples:
                    - fast
                watermark:
                  type: string
                  description: >-
                    Watermark text (optional). If provided, a watermark will be
                    added to the generated video.
                  examples:
                    - MyBrand
                callBackUrl:
                  type: string
                  description: >-
                    Callback URL when the task is completed (optional). Strongly
                    recommended for production environments.


                    - The system will send a POST request to this URL when video
                    extension is completed, containing task status and results

                    - The callback contains generated video URLs, task
                    information, etc.

                    - Your callback endpoint should accept POST requests with
                    JSON payloads containing video results

                    - For detailed callback format and implementation guide, see
                    [Video Generation
                    Callbacks](https://docs.kie.ai/veo3-api/generate-veo-3-video-callbacks)

                    - Alternatively, you can use [the get video details
                    interface](https://docs.kie.ai/veo3-api/get-veo-3-video-details)
                    to poll task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-callback-url.com/veo-extend-callback
              required:
                - taskId
                - prompt
              x-apidog-orders:
                - taskId
                - prompt
                - seeds
                - model
                - watermark
                - callBackUrl
              examples:
                - taskId: veo_task_abcdef123456
                  prompt: >-
                    The dog continues running through the park, jumping over
                    obstacles and playing with other dogs
                  seeds: 12345
                  model: fast
                  watermark: MyBrand
                  callBackUrl: https://your-callback-url.com/veo-extend-callback
              x-apidog-ignore-properties: []
            example:
              taskId: veo_task_abcdef123456
              prompt: >-
                The dog continues running through the park, jumping over
                obstacles and playing with other dogs
              seeds: 12345
              watermark: MyBrand
              callBackUrl: https://your-callback-url.com/veo-extend-callback
              model: fast
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    enum:
                      - 200
                      - 400
                      - 401
                      - 402
                      - 404
                      - 422
                      - 429
                      - 455
                      - 500
                      - 501
                      - 505
                    description: >-
                      Response status code


                      - **200**: Success - Extension task created

                      - **400**: Client error - Prompt violates content policy
                      or other input errors

                      - **401**: Unauthorized - Authentication credentials
                      missing or invalid

                      - **402**: Insufficient credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not found - Original video or task does not
                      exist

                      - **422**: Validation error - Request parameter validation
                      failed

                      - **429**: Rate limit - Exceeded the request limit for
                      this resource

                      - **455**: Service unavailable - System is under
                      maintenance

                      - **500**: Server error - Unexpected error occurred while
                      processing the request

                      - **501**: Extension failed - Video extension task failed

                      - **505**: Feature disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message
                    examples:
                      - success
                  data:
                    type: object
                    properties:
                      taskId:
                        type: string
                        description: >-
                          Task ID that can be used to query task status via the
                          get video details interface
                        examples:
                          - veo_extend_task_xyz789
                    x-apidog-orders:
                      - taskId
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                examples:
                  - code: 200
                    msg: success
                    data:
                      taskId: veo_extend_task_xyz789
                x-apidog-ignore-properties: []
          headers: {}
          x-apidog-name: ''
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      callbacks:
        onVideoExtended:
          '{$request.body#/callBackUrl}':
            post:
              summary: Video Extension Callback
              description: >-
                When the video extension task is completed, the system will send
                the result to your provided callback URL via POST request
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        code:
                          type: integer
                          description: >-
                            Status code


                            - **200**: Success - Video extension task successful

                            - **400**: Your prompt was flagged by the website as
                            violating content policies.

                            English prompts only.

                            Unable to retrieve image. Please verify any access
                            restrictions set by you or your service provider.

                            Public error: Unsafe image upload.

                            - **500**: Internal error, please try again later.

                            Internal error - Timeout

                            - **501**: Failed - Video extension task failed
                          enum:
                            - 200
                            - 400
                            - 500
                            - 501
                        msg:
                          type: string
                          description: Status message
                          example: Veo3.1 video extension successful.
                        data:
                          type: object
                          properties:
                            taskId:
                              type: string
                              description: Task ID
                              example: veo_extend_task_xyz789
                            info:
                              type: object
                              properties:
                                resultUrls:
                                  type: string
                                  description: Extended video URLs
                                  example: '[http://example.com/extended_video1.mp4]'
                                originUrls:
                                  type: string
                                  description: >-
                                    Original video URLs. Only available when
                                    aspect_ratio is not 16:9
                                  example: '[http://example.com/original_video1.mp4]'
                                resolution:
                                  type: string
                                  description: Video resolution information
                                  example: 1080p
                            fallbackFlag:
                              type: boolean
                              description: >-
                                Whether generated through fallback model. true
                                means using backup model generation, false means
                                using main model generation
                              example: false
                              deprecated: true
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Veo3.1 API
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506315-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Generate Veo3.1 Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/veo/generate:
    post:
      summary: Generate Veo3.1 Video
      deprecated: false
      description: >-
        ::: info[]

        Create a new video generation task using the Veo3.1 AI model.

        :::

        Our **Veo 3.1 Generation API** is more than a direct wrapper around
        Google's baseline. It layers extensive optimisation and reliability
        tooling on top of the official models, giving you greater flexibility
        and markedly higher success rates — **25% of the official Google
        pricing** (see [kie.ai/pricing](https://kie.ai/pricing) for full
        details).


        | Capability           | Details |

        | :------------------- | :------ |

        | **Models**           | • **Veo 3.1 Quality** — flagship model, highest
        fidelity<br />• **Veo 3.1 Fast** — cost-efficient variant that still
        delivers strong visual results |

        | **Tasks**            | • **Text → Video**<br />• **Image → Video**
        (single reference frame or first and last frames)<br />• **Material →
        Video** (based on material images) |

        | **Generation Modes** | • **TEXT\_2\_VIDEO** — Text-to-video: using
        text prompts only<br />• **FIRST\_AND\_LAST\_FRAMES\_2\_VIDEO** — First
        and last frames to video: generate transition videos using one or two
        images<br />• **REFERENCE\_2\_VIDEO** — Material-to-video: based on
        material images (**Fast model only**, supports **16:9 & 9:16**) |

        | **Aspect Ratios**    | Supports both native **16:9** and **9:16**
        outputs. **Auto** mode lets the system decide aspect ratio based on
        input materials and internal strategy (for production control, we
        recommend explicitly setting `aspect_ratio`). |

        | **Output Quality**   | Both **16:9** and **9:16** support **1080P**
        and **4K** outputs. **4K requires extra credits** (approximately **2×
        the credits of generating a Fast mode video**) and is requested via a
        separate 4K endpoint. |

        | **Audio Track**      | All videos ship with background audio by
        default. In rare cases, upstream may suppress audio when the scene is
        deemed sensitive (e.g. minors). |


        ### Why our Veo 3.1 API is different


        1. **True vertical video** – Native Veo 3.1 supports **9:16** output,
        delivering authentic vertical videos without the need for re-framing or
        manual editing.

        2. **Global language reach** – Our flow supports multilingual prompts by
        default (no extra configuration required).

        3. **Significant cost savings** – Our rates are 25% of Google's direct
        API pricing.
      operationId: generate-veo3-1-video
      tags:
        - docs/en/Market/Veo3.1 API
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: >-
                    Text prompt describing the desired video content. Required
                    for all generation modes.


                    - Should be detailed and specific in describing video
                    content

                    - Can include actions, scenes, style and other information

                    - For image-to-video, describe how you want the image to
                    come alive
                  examples:
                    - A dog playing in a park
                imageUrls:
                  type: array
                  items:
                    type: string
                  description: >-
                    Image URL list (used in image-to-video mode). Supports 1 or
                    2 images:


                    - **1 image**: The generated video will unfold around this
                    image, with the image content presented dynamically

                    - **2 images**: The first image serves as the video's first
                    frame, and the second image serves as the video's last
                    frame, with the video transitioning between them

                    - Must be valid image URLs

                    - Images must be accessible to the API server.
                  examples:
                    - - http://example.com/image1.jpg
                      - http://example.com/image2.jpg
                model:
                  type: string
                  description: >-
                    Select the model type to use.


                    - veo3: Veo 3.1 Quality, supports both text-to-video and
                    image-to-video generation

                    - veo3_fast: Veo3.1 Fast generation model, supports both
                    text-to-video and image-to-video generation
                  enum:
                    - veo3
                    - veo3_fast
                  default: veo3_fast
                  examples:
                    - veo3_fast
                generationType:
                  type: string
                  description: >-
                    Video generation mode (optional). Specifies different video
                    generation approaches:


                    - **TEXT_2_VIDEO**: Text-to-video - Generate videos using
                    only text prompts

                    - **FIRST_AND_LAST_FRAMES_2_VIDEO**: First and last frames
                    to video - Flexible image-to-video generation mode
                      - 1 image: Generate video based on the provided image
                      - 2 images: First image as first frame, second image as last frame, generating transition video
                    - **REFERENCE_2_VIDEO**: Reference-to-video - Generate
                    videos based on reference images, requires 1-3 images in
                    imageUrls (minimum 1, maximum 3)


                    **Important Notes**:

                    - REFERENCE_2_VIDEO mode currently only supports veo3_fast
                    model

                    - If not specified, the system will automatically determine
                    the generation mode based on whether imageUrls are provided
                  enum:
                    - TEXT_2_VIDEO
                    - FIRST_AND_LAST_FRAMES_2_VIDEO
                    - REFERENCE_2_VIDEO
                  examples:
                    - TEXT_2_VIDEO
                aspect_ratio:
                  type: string
                  description: >-
                    Video aspect ratio. Specifies the dimension ratio of the
                    generated video. Available options:


                    - 16:9: Landscape video format. 

                    - 9:16: Portrait video format, suitable for mobile short
                    videos

                    - Auto: In auto mode, the video will be automatically
                    center-cropped based on whether your uploaded image is
                    closer to 16:9 or 9:16.


                    Default value is 16:9.
                  enum:
                    - '16:9'
                    - '9:16'
                    - Auto
                  default: '16:9'
                  examples:
                    - '16:9'
                seeds:
                  type: integer
                  description: >-
                    (Optional) Random seed parameter to control the randomness
                    of the generated content. Value range: 10000-99999. The same
                    seed will generate similar video content, different seeds
                    will generate different content. If not provided, the system
                    will assign one automatically.
                  minimum: 10000
                  maximum: 99999
                  examples:
                    - 12345
                callBackUrl:
                  type: string
                  description: >-
                    Completion callback URL for receiving video generation
                    status updates.


                    - Optional but recommended for production use

                    - System will POST task completion status to this URL when
                    the video generation is completed

                    - Callback will include task results, video URLs, and status
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload

                    - For detailed callback format and implementation guide, see
                    [Callback
                    Documentation](https://docs.kie.ai/veo3-api/generate-veo-3-video-callbacks)

                    - Alternatively, use the Get Video Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - http://your-callback-url.com/complete
                enableFallback:
                  type: boolean
                  description: >-
                    Deprecated Enable fallback functionality. When set to true,
                    if the official Veo3.1 video generation service is
                    unavailable or encounters exceptions, the system will
                    automatically switch to a backup model for video generation
                    to ensure task continuity and reliability. Default value is
                    false.


                    - When fallback is enabled, backup model will be used for
                    the following errors:
                      - public error minor upload
                      - Your prompt was flagged by Website as violating content policies
                      - public error prominent people upload
                    - Fallback mode requires 16:9 aspect ratio and uses 1080p
                    resolution by default

                    - **Note**: Videos generated through fallback mode cannot be
                    accessed via the Get 1080P Video endpoint

                    - **Credit Consumption**: Successful fallback has different
                    credit consumption, please see https://kie.ai/pricing for
                    pricing details


                    **Note: This parameter is deprecated. Please remove this
                    parameter from your requests. The system has automatically
                    optimized the content review mechanism without requiring
                    manual fallback configuration.**
                  default: false
                  deprecated: true
                  examples:
                    - false
                enableTranslation:
                  type: boolean
                  description: >-
                    Enable prompt translation to English. When set to true, the
                    system will automatically translate prompts to English
                    before video generation for better generation results.
                    Default value is true.


                    - true: Enable translation, prompts will be automatically
                    translated to English

                    - false: Disable translation, use original prompts directly
                    for generation
                  default: true
                  examples:
                    - true
                watermark:
                  type: string
                  description: >-
                    Watermark text.


                    - Optional parameter

                    - If provided, a watermark will be added to the generated
                    video
                  examples:
                    - MyBrand
              required:
                - prompt
              x-apidog-orders:
                - prompt
                - imageUrls
                - model
                - generationType
                - aspect_ratio
                - seeds
                - callBackUrl
                - enableFallback
                - enableTranslation
                - watermark
              examples:
                - prompt: A dog playing in a park
                  imageUrls:
                    - http://example.com/image1.jpg
                    - http://example.com/image2.jpg
                  model: veo3_fast
                  watermark: MyBrand
                  callBackUrl: http://your-callback-url.com/complete
                  aspect_ratio: '16:9'
                  seeds: 12345
                  enableFallback: false
                  enableTranslation: true
                  generationType: REFERENCE_2_VIDEO
              x-apidog-ignore-properties: []
            example:
              prompt: A dog playing in a park
              imageUrls:
                - http://example.com/image1.jpg
                - http://example.com/image2.jpg
              model: veo3_fast
              watermark: MyBrand
              callBackUrl: http://your-callback-url.com/complete
              aspect_ratio: '16:9'
              seeds: 12345
              enableFallback: false
              enableTranslation: true
              generationType: REFERENCE_2_VIDEO
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    enum:
                      - 200
                      - 400
                      - 401
                      - 402
                      - 404
                      - 422
                      - 429
                      - 455
                      - 500
                      - 501
                      - 505
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **400**: 1080P is processing. It should be ready in 1-2
                      minutes. Please check back shortly.

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - Request parameters failed
                      validation. When fallback is not enabled and generation
                      fails, error message format: Your request was rejected by
                      Flow(original error message). You may consider using our
                      other fallback channels, which are likely to succeed.
                      Please refer to the documentation.

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Video generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Error message when code != 200
                    examples:
                      - success
                  data:
                    type: object
                    properties:
                      taskId:
                        type: string
                        description: >-
                          Task ID, can be used with Get Video Details endpoint
                          to query task status
                        examples:
                          - veo_task_abcdef123456
                    x-apidog-orders:
                      - taskId
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: veo_task_abcdef123456
          headers: {}
          x-apidog-name: success
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      callbacks:
        onVideoGenerated:
          '{$request.body#/callBackUrl}':
            post:
              summary: Video Generation Callback
              description: >-
                When the video generation task is completed, the system will
                send the result to your provided callback URL via POST request
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        code:
                          type: integer
                          description: >-
                            Status code


                            - **200**: Success - Video generation task
                            successfully

                            - **400**: Your prompt was flagged by Website as
                            violating content policies.

                            Only English prompts are supported at this time.

                            Failed to fetch the image. Kindly verify any access
                            limits set by you or your service provider.

                            public error unsafe image upload.

                            - **422**: Fallback failed - When fallback is not
                            enabled and specific errors occur, returns error
                            message format: Your request was rejected by
                            Flow(original error message). You may consider using
                            our other fallback channels, which are likely to
                            succeed. Please refer to the documentation.

                            - **500**: Internal Error, Please try again later.

                            Internal Error - Timeout

                            - **501**: Failed - Video generation task failed
                          enum:
                            - 200
                            - 400
                            - 422
                            - 500
                            - 501
                        msg:
                          type: string
                          description: Status message
                          example: Veo3.1 video generated successfully.
                        data:
                          type: object
                          properties:
                            taskId:
                              type: string
                              description: Task ID
                              example: veo_task_abcdef123456
                            info:
                              type: object
                              properties:
                                resultUrls:
                                  type: string
                                  description: Generated video URLs
                                  example: '[http://example.com/video1.mp4]'
                                originUrls:
                                  type: string
                                  description: >-
                                    Original video URLs. Only has value when
                                    aspect_ratio is not 16:9
                                  example: '[http://example.com/original_video1.mp4]'
                                resolution:
                                  type: string
                                  description: Video resolution information
                                  example: 1080p
                            fallbackFlag:
                              type: boolean
                              description: >-
                                Whether generated using fallback model. True
                                means backup model was used, false means primary
                                model was used
                              example: false
                              deprecated: true
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Veo3.1 API
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506311-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Kling 2.6 Image to Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Kling 2.6 Image to Video
      deprecated: false
      description: >-
        ## Query Task Status


        After submitting a task, you can check the task progress and retrieve
        generation results via the unified query endpoint:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
          Learn how to query task status and obtain generation results
        </Card>


        ::: tip[]

        In production environments, it is recommended to use the `callBackUrl`
        parameter to receive automatic notifications upon generation completion,
        rather than polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Browse all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check account credits and usage status
          </Card>
        </CardGroup>
      operationId: kling-2-6-image-to-video
      tags:
        - docs/en/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - kling-2.6/image-to-video
                  default: kling-2.6/image-to-video
                  description: >-
                    Name of the model used for the generation task. Required
                    field.


                    - This endpoint must use the `kling-2.6/image-to-video`
                    model
                  examples:
                    - kling-2.6/image-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    Callback URL to receive notifications when the generation
                    task is completed. Optional configuration, recommended for
                    production environments.


                    - After the task is completed, the system will POST the task
                    status and results to this URL

                    - The callback content includes the generated resource URL
                    and task-related information

                    - Your callback endpoint needs to support receiving POST
                    requests with JSON payloads

                    - You can also choose to call the task details endpoint to
                    actively poll the task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      description: >-
                        Text prompt for video generation (maximum length: 1000
                        characters)
                      type: string
                      maxLength: 1000
                      examples:
                        - >-
                          In a bright rehearsal room, sunlight streams through
                          the windows, and a standing microphone is placed in
                          the center of the room. [Campus band female lead
                          singer] stands in front of the microphone with her
                          eyes closed, and other members stand around her.
                          [Campus band female lead singer, singing loudly] Lead
                          vocal: "I will do my best to heal you, with all my
                          heart and soul..." The background is a cappella
                          harmonies, and the camera slowly pans around the band
                          members.
                    image_urls:
                      description: >-
                        Image URLs for video generation. (Uploaded file URLs,
                        not file content; supported types: image/jpeg,
                        image/png, image/webp; maximum file size: 10.0MB)
                      type: array
                      items:
                        type: string
                        format: uri
                      maxItems: 1
                      examples:
                        - - >-
                            https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                    sound:
                      description: >-
                        This parameter specifies whether the generated video
                        contains sound (boolean: true/false)
                      type: boolean
                      examples:
                        - false
                    duration:
                      description: 'Video duration (unit: seconds)'
                      type: string
                      enum:
                        - '5'
                        - '10'
                      default: '5'
                      examples:
                        - '5'
                  required:
                    - prompt
                    - image_urls
                    - sound
                    - duration
                  x-apidog-orders:
                    - prompt
                    - image_urls
                    - sound
                    - duration
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling-2.6/image-to-video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  In a bright rehearsal room, sunlight streams through the
                  windows, and a standing microphone is placed in the center of
                  the room. [Campus band female lead singer] stands in front of
                  the microphone with her eyes closed, and other members stand
                  around her. [Campus band female lead singer, singing loudly]
                  Lead vocal: "I will do my best to heal you, with all my heart
                  and soul..." The background is a cappella harmonies, and the
                  camera slowly pans around the band members.
                image_urls:
                  - >-
                    https://static.aiquickdraw.com/tools/example/1764851002741_i0lEiI8I.png
                sound: false
                duration: '5'
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling-2.6_1765182405025
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506384-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```# Kling 2.6 Text to Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Kling 2.6 Text to Video
      deprecated: false
      description: >-
        ## Query Task Status


        After submitting a task, you can check the task progress and retrieve
        generation results via the unified query endpoint:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
          Learn how to query task status and obtain generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Browse all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check account credits and usage status
          </Card>
        </CardGroup>
      operationId: kling-2-6-text-to-video
      tags:
        - docs/en/Market/Video Models/Kling
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - kling-2.6/text-to-video
                  default: kling-2.6/text-to-video
                  description: >-
                    Name of the model used for the generation task. Required
                    field.


                    - This endpoint must use the `kling-2.6/text-to-video` model
                  examples:
                    - kling-2.6/text-to-video
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    Callback URL to receive notifications when the generation
                    task is completed. Optional configuration, recommended for
                    production environments.


                    - After the task is completed, the system will POST the task
                    status and results to this URL

                    - The callback content includes the generated resource URL
                    and task-related information

                    - Your callback endpoint must support receiving POST
                    requests with JSON payloads

                    - You can also choose to call the task details endpoint to
                    actively poll the task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    prompt:
                      description: >-
                        Text prompt for video generation (maximum length: 1000
                        characters)
                      type: string
                      maxLength: 1000
                      examples:
                        - >-
                          Scene: A fashion live-streaming sales setting, with
                          clothes hanging on racks and the host's figure
                          reflected in a full-length mirror. Lines: [African
                          female host] turns around to showcase the hoodie's
                          cut. [African female host, in a cheerful tone] says:
                          "360-degree flawless tailoring, slimming and
                          versatile." She then [African female host] leans
                          closer to the camera. [African female host, in a
                          lively tone] says: "Double-sided fleece fabric, $30
                          off immediately when you order now."
                    sound:
                      description: >-
                        This parameter specifies whether the generated video
                        contains sound (boolean: true/false)
                      type: boolean
                      examples:
                        - false
                    aspect_ratio:
                      description: This parameter defines the video aspect ratio
                      type: string
                      enum:
                        - '1:1'
                        - '16:9'
                        - '9:16'
                      default: '1:1'
                      examples:
                        - '1:1'
                    duration:
                      description: 'Video duration (unit: seconds)'
                      type: string
                      enum:
                        - '5'
                        - '10'
                      default: '5'
                      examples:
                        - '5'
                  required:
                    - prompt
                    - sound
                    - aspect_ratio
                    - duration
                  x-apidog-orders:
                    - prompt
                    - sound
                    - aspect_ratio
                    - duration
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: kling-2.6/text-to-video
              callBackUrl: https://your-domain.com/api/callback
              input:
                prompt: >-
                  Scene: A fashion live-streaming sales setting, with clothes
                  hanging on racks and the host's figure reflected in a
                  full-length mirror. Lines: [African female host] turns around
                  to showcase the hoodie's cut. [African female host, in a
                  cheerful tone] says: "360-degree flawless tailoring, slimming
                  and versatile." She then [African female host] leans closer to
                  the camera. [African female host, in a lively tone] says:
                  "Double-sided fleece fabric, $30 off immediately when you
                  order now."
                sound: false
                aspect_ratio: '1:1'
                duration: '5'
      responses:
        '200':
          description: Request Successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_kling-2.6_1765182425861
          headers: {}
          x-apidog-name: ''
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Kling
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506383-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```# Generate Veo3.1 Video

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/veo/generate:
    post:
      summary: Generate Veo3.1 Video
      deprecated: false
      description: >-
        ::: info[]

        Create a new video generation task using the Veo3.1 AI model.

        :::

        Our **Veo 3.1 Generation API** is more than a direct wrapper around
        Google's baseline. It layers extensive optimisation and reliability
        tooling on top of the official models, giving you greater flexibility
        and markedly higher success rates — **25% of the official Google
        pricing** (see [kie.ai/pricing](https://kie.ai/pricing) for full
        details).


        | Capability           | Details |

        | :------------------- | :------ |

        | **Models**           | • **Veo 3.1 Quality** — flagship model, highest
        fidelity<br />• **Veo 3.1 Fast** — cost-efficient variant that still
        delivers strong visual results |

        | **Tasks**            | • **Text → Video**<br />• **Image → Video**
        (single reference frame or first and last frames)<br />• **Material →
        Video** (based on material images) |

        | **Generation Modes** | • **TEXT\_2\_VIDEO** — Text-to-video: using
        text prompts only<br />• **FIRST\_AND\_LAST\_FRAMES\_2\_VIDEO** — First
        and last frames to video: generate transition videos using one or two
        images<br />• **REFERENCE\_2\_VIDEO** — Material-to-video: based on
        material images (**Fast model only**, supports **16:9 & 9:16**) |

        | **Aspect Ratios**    | Supports both native **16:9** and **9:16**
        outputs. **Auto** mode lets the system decide aspect ratio based on
        input materials and internal strategy (for production control, we
        recommend explicitly setting `aspect_ratio`). |

        | **Output Quality**   | Both **16:9** and **9:16** support **1080P**
        and **4K** outputs. **4K requires extra credits** (approximately **2×
        the credits of generating a Fast mode video**) and is requested via a
        separate 4K endpoint. |

        | **Audio Track**      | All videos ship with background audio by
        default. In rare cases, upstream may suppress audio when the scene is
        deemed sensitive (e.g. minors). |


        ### Why our Veo 3.1 API is different


        1. **True vertical video** – Native Veo 3.1 supports **9:16** output,
        delivering authentic vertical videos without the need for re-framing or
        manual editing.

        2. **Global language reach** – Our flow supports multilingual prompts by
        default (no extra configuration required).

        3. **Significant cost savings** – Our rates are 25% of Google's direct
        API pricing.
      operationId: generate-veo3-1-video
      tags:
        - docs/en/Market/Veo3.1 API
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                prompt:
                  type: string
                  description: >-
                    Text prompt describing the desired video content. Required
                    for all generation modes.


                    - Should be detailed and specific in describing video
                    content

                    - Can include actions, scenes, style and other information

                    - For image-to-video, describe how you want the image to
                    come alive
                  examples:
                    - A dog playing in a park
                imageUrls:
                  type: array
                  items:
                    type: string
                  description: >-
                    Image URL list (used in image-to-video mode). Supports 1 or
                    2 images:


                    - **1 image**: The generated video will unfold around this
                    image, with the image content presented dynamically

                    - **2 images**: The first image serves as the video's first
                    frame, and the second image serves as the video's last
                    frame, with the video transitioning between them

                    - Must be valid image URLs

                    - Images must be accessible to the API server.
                  examples:
                    - - http://example.com/image1.jpg
                      - http://example.com/image2.jpg
                model:
                  type: string
                  description: >-
                    Select the model type to use.


                    - veo3: Veo 3.1 Quality, supports both text-to-video and
                    image-to-video generation

                    - veo3_fast: Veo3.1 Fast generation model, supports both
                    text-to-video and image-to-video generation
                  enum:
                    - veo3
                    - veo3_fast
                  default: veo3_fast
                  examples:
                    - veo3_fast
                generationType:
                  type: string
                  description: >-
                    Video generation mode (optional). Specifies different video
                    generation approaches:


                    - **TEXT_2_VIDEO**: Text-to-video - Generate videos using
                    only text prompts

                    - **FIRST_AND_LAST_FRAMES_2_VIDEO**: First and last frames
                    to video - Flexible image-to-video generation mode
                      - 1 image: Generate video based on the provided image
                      - 2 images: First image as first frame, second image as last frame, generating transition video
                    - **REFERENCE_2_VIDEO**: Reference-to-video - Generate
                    videos based on reference images, requires 1-3 images in
                    imageUrls (minimum 1, maximum 3)


                    **Important Notes**:

                    - REFERENCE_2_VIDEO mode currently only supports veo3_fast
                    model

                    - If not specified, the system will automatically determine
                    the generation mode based on whether imageUrls are provided
                  enum:
                    - TEXT_2_VIDEO
                    - FIRST_AND_LAST_FRAMES_2_VIDEO
                    - REFERENCE_2_VIDEO
                  examples:
                    - TEXT_2_VIDEO
                aspect_ratio:
                  type: string
                  description: >-
                    Video aspect ratio. Specifies the dimension ratio of the
                    generated video. Available options:


                    - 16:9: Landscape video format. 

                    - 9:16: Portrait video format, suitable for mobile short
                    videos

                    - Auto: In auto mode, the video will be automatically
                    center-cropped based on whether your uploaded image is
                    closer to 16:9 or 9:16.


                    Default value is 16:9.
                  enum:
                    - '16:9'
                    - '9:16'
                    - Auto
                  default: '16:9'
                  examples:
                    - '16:9'
                seeds:
                  type: integer
                  description: >-
                    (Optional) Random seed parameter to control the randomness
                    of the generated content. Value range: 10000-99999. The same
                    seed will generate similar video content, different seeds
                    will generate different content. If not provided, the system
                    will assign one automatically.
                  minimum: 10000
                  maximum: 99999
                  examples:
                    - 12345
                callBackUrl:
                  type: string
                  description: >-
                    Completion callback URL for receiving video generation
                    status updates.


                    - Optional but recommended for production use

                    - System will POST task completion status to this URL when
                    the video generation is completed

                    - Callback will include task results, video URLs, and status
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload

                    - For detailed callback format and implementation guide, see
                    [Callback
                    Documentation](https://docs.kie.ai/veo3-api/generate-veo-3-video-callbacks)

                    - Alternatively, use the Get Video Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - http://your-callback-url.com/complete
                enableFallback:
                  type: boolean
                  description: >-
                    Deprecated Enable fallback functionality. When set to true,
                    if the official Veo3.1 video generation service is
                    unavailable or encounters exceptions, the system will
                    automatically switch to a backup model for video generation
                    to ensure task continuity and reliability. Default value is
                    false.


                    - When fallback is enabled, backup model will be used for
                    the following errors:
                      - public error minor upload
                      - Your prompt was flagged by Website as violating content policies
                      - public error prominent people upload
                    - Fallback mode requires 16:9 aspect ratio and uses 1080p
                    resolution by default

                    - **Note**: Videos generated through fallback mode cannot be
                    accessed via the Get 1080P Video endpoint

                    - **Credit Consumption**: Successful fallback has different
                    credit consumption, please see https://kie.ai/pricing for
                    pricing details


                    **Note: This parameter is deprecated. Please remove this
                    parameter from your requests. The system has automatically
                    optimized the content review mechanism without requiring
                    manual fallback configuration.**
                  default: false
                  deprecated: true
                  examples:
                    - false
                enableTranslation:
                  type: boolean
                  description: >-
                    Enable prompt translation to English. When set to true, the
                    system will automatically translate prompts to English
                    before video generation for better generation results.
                    Default value is true.


                    - true: Enable translation, prompts will be automatically
                    translated to English

                    - false: Disable translation, use original prompts directly
                    for generation
                  default: true
                  examples:
                    - true
                watermark:
                  type: string
                  description: >-
                    Watermark text.


                    - Optional parameter

                    - If provided, a watermark will be added to the generated
                    video
                  examples:
                    - MyBrand
              required:
                - prompt
              x-apidog-orders:
                - prompt
                - imageUrls
                - model
                - generationType
                - aspect_ratio
                - seeds
                - callBackUrl
                - enableFallback
                - enableTranslation
                - watermark
              examples:
                - prompt: A dog playing in a park
                  imageUrls:
                    - http://example.com/image1.jpg
                    - http://example.com/image2.jpg
                  model: veo3_fast
                  watermark: MyBrand
                  callBackUrl: http://your-callback-url.com/complete
                  aspect_ratio: '16:9'
                  seeds: 12345
                  enableFallback: false
                  enableTranslation: true
                  generationType: REFERENCE_2_VIDEO
              x-apidog-ignore-properties: []
            example:
              prompt: A dog playing in a park
              imageUrls:
                - http://example.com/image1.jpg
                - http://example.com/image2.jpg
              model: veo3_fast
              watermark: MyBrand
              callBackUrl: http://your-callback-url.com/complete
              aspect_ratio: '16:9'
              seeds: 12345
              enableFallback: false
              enableTranslation: true
              generationType: REFERENCE_2_VIDEO
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    enum:
                      - 200
                      - 400
                      - 401
                      - 402
                      - 404
                      - 422
                      - 429
                      - 455
                      - 500
                      - 501
                      - 505
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **400**: 1080P is processing. It should be ready in 1-2
                      minutes. Please check back shortly.

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - Request parameters failed
                      validation. When fallback is not enabled and generation
                      fails, error message format: Your request was rejected by
                      Flow(original error message). You may consider using our
                      other fallback channels, which are likely to succeed.
                      Please refer to the documentation.

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Video generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Error message when code != 200
                    examples:
                      - success
                  data:
                    type: object
                    properties:
                      taskId:
                        type: string
                        description: >-
                          Task ID, can be used with Get Video Details endpoint
                          to query task status
                        examples:
                          - veo_task_abcdef123456
                    x-apidog-orders:
                      - taskId
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 200
                msg: success
                data:
                  taskId: veo_task_abcdef123456
          headers: {}
          x-apidog-name: success
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      callbacks:
        onVideoGenerated:
          '{$request.body#/callBackUrl}':
            post:
              summary: Video Generation Callback
              description: >-
                When the video generation task is completed, the system will
                send the result to your provided callback URL via POST request
              requestBody:
                required: true
                content:
                  application/json:
                    schema:
                      type: object
                      properties:
                        code:
                          type: integer
                          description: >-
                            Status code


                            - **200**: Success - Video generation task
                            successfully

                            - **400**: Your prompt was flagged by Website as
                            violating content policies.

                            Only English prompts are supported at this time.

                            Failed to fetch the image. Kindly verify any access
                            limits set by you or your service provider.

                            public error unsafe image upload.

                            - **422**: Fallback failed - When fallback is not
                            enabled and specific errors occur, returns error
                            message format: Your request was rejected by
                            Flow(original error message). You may consider using
                            our other fallback channels, which are likely to
                            succeed. Please refer to the documentation.

                            - **500**: Internal Error, Please try again later.

                            Internal Error - Timeout

                            - **501**: Failed - Video generation task failed
                          enum:
                            - 200
                            - 400
                            - 422
                            - 500
                            - 501
                        msg:
                          type: string
                          description: Status message
                          example: Veo3.1 video generated successfully.
                        data:
                          type: object
                          properties:
                            taskId:
                              type: string
                              description: Task ID
                              example: veo_task_abcdef123456
                            info:
                              type: object
                              properties:
                                resultUrls:
                                  type: string
                                  description: Generated video URLs
                                  example: '[http://example.com/video1.mp4]'
                                originUrls:
                                  type: string
                                  description: >-
                                    Original video URLs. Only has value when
                                    aspect_ratio is not 16:9
                                  example: '[http://example.com/original_video1.mp4]'
                                resolution:
                                  type: string
                                  description: Video resolution information
                                  example: 1080p
                            fallbackFlag:
                              type: boolean
                              description: >-
                                Whether generated using fallback model. True
                                means backup model was used, false means primary
                                model was used
                              example: false
                              deprecated: true
              responses:
                '200':
                  description: Callback received successfully
      x-apidog-folder: docs/en/Market/Veo3.1 API
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506311-run
components:
  schemas: {}
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```

seedance 2.0 preview from piapi: # Seedance 2 preview

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/task:
    post:
      summary: Seedance 2 preview
      deprecated: false
      description: >-
        # Overview

        Seedance 2.0 provides high‑quality video generation from text prompts,
        with optional image references to control subject appearance or style,
        and optional video input for video editing. This document describes the
        available models, pricing, usage guidelines, and the syntax for
        referencing images and videos in your prompts.


        Currently available models:

        - seedance-2-preview

        - seedance-2-fast-preview


        # Pricing


        | Model | Mode | Price per second |

        | --- | --- | --- |

        | seedance-2-preview | Text/Image to Video | $0.15 |

        | seedance-2-fast-preview | Text/Image to Video | $0.08 |

        | seedance-2-preview | Video Edit | $0.25 |

        | seedance-2-fast-preview | Video Edit | $0.13 |


        - For Video Edit mode, the `duration` parameter is ignored. Since this
        mode edits the original video, the output video length equals the input
        video length. Billing is based on the actual output video duration.

        - Price modeification was applied on seedance video edit tasks on
        2026/02/23


        # Note

        - Peak hours: From 09:00 to 15:00 GMT, Seedance experiences high
        traffic. During this period, queue times may extend to several hours.

        - Reference images: The API supports using one or more images as
        references in your prompts. See Using Image References for syntax.
        Maximum 9 images.

        - Video edit: The API supports editing an existing video by providing it
        via `video_urls`. See Video Edit below.

        - Aspect ratio: The aspect ratio of the reference image takes precedence
        over the aspect ratio specified in the request parameters. (We have
        noticed the issue that the aspect ratio parameter is currently not
        taking effect and are working on a fix.)


        # Using Image References in Prompts

        When you include images in your request, you can reference them directly
        in the text prompt using the @imageN placeholder, where N is the 1‑based
        position of the image in the request (e.g., the first uploaded image is
        @image1).


        ## Syntax

        @image1, @image2, … – reference the image at the corresponding position.


        You can use multiple references in a single prompt to indicate different
        subjects or transitions.


        The engine automatically converts @imageN to the upstream API format
        【@图片N】 for compatibility. You may also use the Chinese format directly
        if preferred.


        ## Examples

        ### Single image reference

        The cat in @image1 walks through a garden


        ### Morphing effect

        @image1 transforms into @image2


        ### Multi‑subject scene

        The whale in @image1 meets the ninja in @image2


        ## Validation

        If your prompt references an image that was not provided (e.g., you use
        @image3 but only two images are supplied), the request will be rejected
        with a 400 Bad Request error.


        # Video Edit

        You can provide a video via the `video_urls` array to enable video edit
        mode. In this mode, Seedance edits the original video based on the
        transformations described in your prompt. The output video has the same
        length as the input video.


        ## How it works

        - Provide exactly one video URL in the `video_urls` array.

        - The `duration` parameter is ignored in this mode — the output video
        length equals the input video length, since this mode edits the original
        video rather than generating a new one.

        - You may combine video edit with image references (via `image_urls`) to
        control subject appearance in the edited video (e.g., replace a
        character).

        - The input video must pass a content safety review. If the video is
        rejected, the task will fail with an error message indicating the media
        did not pass the security check.


        ## Tips

        - Use publicly accessible video URLs (e.g., hosted on a CDN or cloud
        storage).

        - Keep input videos short (5–15 seconds) for best results.

        - Describe the desired transformation clearly in your prompt (e.g.,
        style changes, lighting, effects, character replacement).
      operationId: flux-api/text-to-image
      tags:
        - Endpoints/Seedance
      parameters:
        - name: X-API-Key
          in: header
          description: Your API KEY used for request authorization
          required: true
          example: ''
          schema:
            type: string
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                model:
                  type: string
                  description: the model name
                  enum:
                    - seedance
                  default: seedance
                task_type:
                  type: string
                  description: the task_type
                  enum:
                    - seedance-2-preview
                    - seedance-2-fast-preview
                input:
                  type: object
                  properties:
                    prompt:
                      type: string
                      description: the text prompt describing the video to generate
                    duration:
                      type: integer
                      description: >-
                        Duration of the generated video in seconds. Ignored when
                        `video_urls` is provided (video edit mode) — the output
                        length equals the input video length.
                      enum:
                        - 5
                        - 10
                        - 15
                      default: 5
                    aspect_ratio:
                      type: string
                      enum:
                        - '16:9'
                        - '9:16'
                        - '4:3'
                        - '3:4'
                      default: '16:9'
                      description: aspect ratio of the gerenated video
                    image_urls:
                      type: array
                      items:
                        type: string
                        description: reference image url
                      description: >-
                        reference image URLs for image-to-video or to control
                        subject appearance. Maximum 9 images.
                    video_urls:
                      type: array
                      items:
                        type: string
                        description: reference video url
                      description: >-
                        Video URL for video edit mode. When provided, the input
                        video is edited based on the prompt. The `duration`
                        parameter is ignored — the output video length equals
                        the input video length. Currently supports exactly one
                        video URL.
                    parent_task_id:
                      type: string
                      description: >-
                        parent task id for extend video. if
                        prompt/duration/aspect_ratio is not proveded, will use
                        the parent task param
                  required:
                    - prompt
                  description: |
                    the input param of the omni human task
                  x-apidog-orders:
                    - prompt
                    - duration
                    - aspect_ratio
                    - image_urls
                    - video_urls
                    - parent_task_id
                config:
                  type: object
                  properties:
                    webhook_config:
                      type: object
                      properties:
                        endpoint:
                          type: string
                        secret:
                          type: string
                      description: >-
                        Webhook provides timely task notifications. Check [PiAPI
                        webhook](/docs/unified-webhook) for detail.
                      x-apidog-orders:
                        - endpoint
                        - secret
                    service_mode:
                      type: string
                      description: >
                        This allows users to choose whether this specific task
                        will get processed under PAYG or HYA mode. If
                        unspecified, then this task will get processed under
                        whatever mode (PAYG or HYA)
                         the user chose on the workspace setting of your account.
                        - `public` means this task will be processed under PAYG
                        mode.

                        - `private` means this task will be processed under HYA
                        mode.
                      enum:
                        - public
                        - private
                  x-apidog-orders:
                    - webhook_config
                    - service_mode
              required:
                - model
                - task_type
                - input
              x-apidog-orders:
                - model
                - task_type
                - input
                - config
            examples:
              '1':
                value:
                  model: seedance
                  task_type: seedance-2-preview
                  input:
                    prompt: A woman sings and strums her guitar
                    duration: 5
                    aspect_ratio: '16:9'
                  config:
                    webhook_config:
                      endpoint: >-
                        https://webhook.site/440dc876-c92a-4ef7-a3c5-2f4a8f528601
                      secret: ''
                summary: text to video
              '2':
                value:
                  model: seedance
                  task_type: seedance-2-preview
                  input:
                    aspect_ratio: '9:16'
                    duration: 5
                    image_urls:
                      - https://goapi.ai/workspace/qwen/txt_output_example.png
                    prompt: A woman interviews on street
                  config:
                    webhook_config:
                      endpoint: >-
                        https://webhook.site/49ed75f4-abc7-4fea-b33c-211323a4deb9
                      secret: ''
                summary: image to video
              '3':
                value:
                  model: seedance
                  task_type: seedance-2-preview
                  input:
                    parent_task_id: d3b93463-949e-4276-ad3e-bd53d3144a46
                  config:
                    webhook_config:
                      endpoint: >-
                        https://webhook.site/49ed75f4-abc7-4fea-b33c-211323a4deb9
                      secret: ''
                summary: extend video simple
              '4':
                value:
                  model: seedance
                  task_type: seedance-2-preview
                  input:
                    parent_task_id: d3b93463-949e-4276-ad3e-bd53d3144a46
                    prompt: ''
                    duration: 5
                    aspect_ratio: '16:9'
                  config:
                    webhook_config:
                      endpoint: >-
                        https://webhook.site/49ed75f4-abc7-4fea-b33c-211323a4deb9
                      secret: ''
                summary: extend video with details
              '5':
                value:
                  model: seedance
                  task_type: seedance-2-fast-preview
                  input:
                    prompt: >-
                      Transform this video into a cinematic scene with warm
                      golden lighting, shallow depth of field, and subtle film
                      grain
                    video_urls:
                      - >-
                        https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4
                    aspect_ratio: '16:9'
                summary: video edit
              '6':
                value:
                  model: seedance
                  task_type: seedance-2-fast-preview
                  input:
                    prompt: >-
                      Replace the person in the video with the character in
                      @image1
                    video_urls:
                      - https://example.com/your-reference-video.mp4
                    image_urls:
                      - https://example.com/your-character-image.jpg
                    aspect_ratio: '16:9'
                summary: video edit with image (character replacement)
      responses:
        '200':
          description: ''
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                  data:
                    type: object
                    properties:
                      task_id:
                        type: string
                      model:
                        type: string
                      task_type:
                        type: string
                      status:
                        type: string
                        enum:
                          - Completed
                          - Processing
                          - Pending
                          - Failed
                          - Staged
                        description: >-
                          Hover on the "Completed" option and you coult see the
                          explaintion of all status:
                          completed/processing/pending/failed/staged
                      input:
                        type: object
                        properties: {}
                        x-apidog-orders: []
                      output:
                        type: object
                        properties:
                          video:
                            type: string
                            description: URL of the generated video
                        required:
                          - video
                        x-apidog-orders:
                          - video
                      meta:
                        type: object
                        properties:
                          created_at:
                            type: string
                            description: >-
                              The time when the task was submitted to us (staged
                              and/or pending)
                          started_at:
                            type: string
                            description: >-
                              The time when the task started processing. the
                              time from created_at to time of started_at is time
                              the job spent in the "staged“ stage and/or
                              the"pending" stage if there were any.
                          ended_at:
                            type: string
                            description: The time when the task finished processing.
                          usage:
                            type: object
                            properties:
                              type:
                                type: string
                              frozen:
                                type: number
                              consume:
                                type: number
                            required:
                              - type
                              - frozen
                              - consume
                            x-apidog-orders:
                              - type
                              - frozen
                              - consume
                          is_using_private_pool:
                            type: boolean
                        required:
                          - usage
                          - is_using_private_pool
                        x-apidog-orders:
                          - created_at
                          - started_at
                          - ended_at
                          - usage
                          - is_using_private_pool
                      detail:
                        type: 'null'
                      logs:
                        type: array
                        items:
                          type: object
                          properties: {}
                          x-apidog-orders: []
                      error:
                        type: object
                        properties:
                          code:
                            type: integer
                          message:
                            type: string
                        x-apidog-orders:
                          - code
                          - message
                    required:
                      - task_id
                      - model
                      - task_type
                      - status
                      - input
                      - output
                      - meta
                      - detail
                      - logs
                      - error
                    x-apidog-orders:
                      - task_id
                      - model
                      - task_type
                      - status
                      - input
                      - output
                      - meta
                      - detail
                      - logs
                      - error
                  message:
                    type: string
                    description: >-
                      If you get non-null error message, here are some steps you
                      chould follow:

                      - Check our [common error
                      message](https://climbing-adapter-afb.notion.site/Common-Error-Messages-6d108f5a8f644238b05ca50d47bbb0f4)

                      - Retry for several times

                      - If you have retried for more than 3 times and still not
                      work, file a ticket on Discord and our support will be
                      with you soon.
                required:
                  - code
                  - data
                  - message
                x-apidog-orders:
                  - code
                  - data
                  - message
              examples:
                Task created (pending):
                  summary: Task created (pending)
                  value:
                    code: 200
                    data:
                      task_id: 07ed43de-465d-43b1-b62c-44249b14d818
                      model: seedance
                      task_type: seedance-2-preview
                      status: pending
                      config:
                        service_mode: ''
                        webhook_config:
                          endpoint: ''
                          secret: ''
                      input:
                        prompt: A woman sings and strums her guitar
                        duration: 5
                        aspect_ratio: '16:9'
                      output: null
                      meta:
                        created_at: '2026-02-27T13:33:26.10346684Z'
                        started_at: '0001-01-01T00:00:00Z'
                        ended_at: '0001-01-01T00:00:00Z'
                        usage:
                          type: llm
                          frozen: 0
                          consume: 7500000
                        is_using_private_pool: false
                      detail: null
                      logs: []
                      error:
                        code: 0
                        raw_message: ''
                        message: ''
                        detail: null
                    message: success
                Video edit completed:
                  summary: Video edit completed
                  value:
                    code: 200
                    data:
                      task_id: 34b90e72-778d-4066-921f-98bb88677d19
                      model: seedance
                      task_type: seedance-2-fast-preview
                      status: completed
                      config:
                        service_mode: ''
                        webhook_config:
                          endpoint: ''
                          secret: ''
                      input:
                        prompt: >-
                          Transform this video into a cinematic scene with warm
                          golden lighting, shallow depth of field, and subtle
                          film grain
                        video_urls:
                          - >-
                            https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerMeltdowns.mp4
                        aspect_ratio: '16:9'
                        duration: 0
                      output:
                        video: >-
                          https://img.theapi.app/ephemeral/66312e05-1916-4243-9972-8368322a30f4.mp4
                      meta:
                        created_at: '2026-03-18T00:42:40.682849488Z'
                        started_at: '2026-03-18T00:42:43.09596373Z'
                        ended_at: '2026-03-18T00:49:24.009330016Z'
                        usage:
                          type: llm
                          frozen: 0
                          consume: 12000000
                        is_using_private_pool: false
                      detail: null
                      logs: []
                      error:
                        code: 0
                        raw_message: ''
                        message: ''
                        detail: null
                    message: success
          headers: {}
          x-apidog-name: Success
      security: []
      x-apidog-folder: Endpoints/Seedance
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/675356/apis/api-28734967-run
components:
  schemas: {}
  securitySchemes: {}
servers:
  - url: https://api.piapi.ai
    description: Develop Env
security: []

```

# Wan - Animate Replace

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Wan - Animate Replace
      deprecated: false
      description: >-
        Content generation using Wan's advanced AI model


        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
           Learn how to query task status and retrieve generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Explore all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check credits and account usage
          </Card>
        </CardGroup>
      operationId: wan-2-2-animate-replace
      tags:
        - docs/en/Market/Video Models/Wan
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - wan/2-2-animate-replace
                  default: wan/2-2-animate-replace
                  description: |-
                    The model name to use for generation. Required field.

                    - Must be `wan/2-2-animate-replace` for this endpoint
                  examples:
                    - wan/2-2-animate-replace
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    video_url:
                      description: >-
                        URL of the input video. (File URL after upload, not file
                        content; Accepted types: video/mp4, video/quicktime,
                        video/x-matroska; Max size: 10.0MB)
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/17586199429271xscyd5d.mp4
                    image_url:
                      description: >-
                        URL of the input image. If the input image does not
                        match the chosen aspect ratio, it is resized and center
                        cropped. (File URL after upload, not file content;
                        Accepted types: image/jpeg, image/png, image/webp; Max
                        size: 10.0MB)
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/17586199255323tks43kq.png
                    resolution:
                      description: Resolution of the generated video (480p, 580p, or 720p).
                      type: string
                      enum:
                        - 480p
                        - 580p
                        - 720p
                      default: 480p
                      examples:
                        - 480p
                    nsfw_checker:
                      type: boolean
                      description: >-
                        Enabled by default in Playground. For API calls, you can
                        turn it on or off based on your needs.
                  required:
                    - video_url
                    - image_url
                  x-apidog-orders:
                    - video_url
                    - image_url
                    - resolution
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: wan/2-2-animate-replace
              callBackUrl: https://your-domain.com/api/callback
              input:
                video_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/17586199429271xscyd5d.mp4
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/17586199255323tks43kq.png
                resolution: 480p
                nsfw_checker: false
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_wan_1765185004558
          headers: {}
          x-apidog-name: ''
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Wan
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506420-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```
# Wan - Animate Move

## OpenAPI Specification

```yaml
openapi: 3.0.1
info:
  title: ''
  description: ''
  version: 1.0.0
paths:
  /api/v1/jobs/createTask:
    post:
      summary: Wan - Animate Move
      deprecated: false
      description: >-
        Content generation using Wan's advanced AI model


        ## Query Task Status


        After submitting a task, use the unified query endpoint to check
        progress and retrieve results:


        <Card title="Get Task Details" icon="lucide-search"
        href="/market/common/get-task-detail">
           Learn how to query task status and retrieve generation results
        </Card>


        ::: tip[]

        For production use, we recommend using the `callBackUrl` parameter to
        receive automatic notifications when generation completes, rather than
        polling the status endpoint.

        :::


        ## Related Resources


        <CardGroup cols={2}>
          <Card title="Market Overview" icon="lucide-store" href="/market/quickstart">
            Explore all available models
          </Card>
          <Card title="Common API" icon="lucide-cog" href="/common-api/get-account-credits">
            Check credits and account usage
          </Card>
        </CardGroup>
      operationId: wan-2-2-animate-move
      tags:
        - docs/en/Market/Video Models/Wan
      parameters: []
      requestBody:
        content:
          application/json:
            schema:
              type: object
              required:
                - model
              properties:
                model:
                  type: string
                  enum:
                    - wan/2-2-animate-move
                  default: wan/2-2-animate-move
                  description: |-
                    The model name to use for generation. Required field.

                    - Must be `wan/2-2-animate-move` for this endpoint
                  examples:
                    - wan/2-2-animate-move
                callBackUrl:
                  type: string
                  format: uri
                  description: >-
                    The URL to receive generation task completion updates.
                    Optional but recommended for production use.


                    - System will POST task status and results to this URL when
                    generation completes

                    - Callback includes generated content URLs and task
                    information

                    - Your callback endpoint should accept POST requests with
                    JSON payload containing results

                    - Alternatively, use the Get Task Details endpoint to poll
                    task status

                    - To ensure callback security, see [Webhook Verification
                    Guide](/common-api/webhook-verification) for signature
                    verification implementation
                  examples:
                    - https://your-domain.com/api/callback
                input:
                  type: object
                  description: Input parameters for the generation task
                  properties:
                    video_url:
                      description: >-
                        URL of the input video. (File URL after upload, not file
                        content; Accepted types: video/mp4, video/quicktime,
                        video/x-matroska; Max size: 10.0MB)
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/17586254974931y2hottk.mp4
                    image_url:
                      description: >-
                        URL of the input image. If the input image does not
                        match the chosen aspect ratio, it is resized and center
                        cropped. (File URL after upload, not file content;
                        Accepted types: image/jpeg, image/png, image/webp; Max
                        size: 10.0MB)
                      type: string
                      examples:
                        - >-
                          https://file.aiquickdraw.com/custom-page/akr/section-images/1758625466310wpehpbnf.png
                    resolution:
                      description: Resolution of the generated video (480p, 580p, or 720p).
                      type: string
                      enum:
                        - 480p
                        - 580p
                        - 720p
                      default: 480p
                      examples:
                        - 480p
                    nsfw_checker:
                      type: boolean
                      description: >-
                        Enabled by default in Playground. For API calls, you can
                        turn it on or off based on your needs.
                  required:
                    - video_url
                    - image_url
                  x-apidog-orders:
                    - video_url
                    - image_url
                    - resolution
                    - nsfw_checker
                  x-apidog-ignore-properties: []
              x-apidog-orders:
                - model
                - callBackUrl
                - input
              x-apidog-ignore-properties: []
            example:
              model: wan/2-2-animate-move
              callBackUrl: https://your-domain.com/api/callback
              input:
                video_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/17586254974931y2hottk.mp4
                image_url: >-
                  https://file.aiquickdraw.com/custom-page/akr/section-images/1758625466310wpehpbnf.png
                resolution: 480p
                nsfw_checker: false
      responses:
        '200':
          description: Request successful
          content:
            application/json:
              schema:
                allOf:
                  - $ref: '#/components/schemas/ApiResponse'
              example:
                code: 200
                msg: success
                data:
                  taskId: task_wan_1765184995754
          headers: {}
          x-apidog-name: ''
        '500':
          description: request failed
          content:
            application/json:
              schema:
                type: object
                properties:
                  code:
                    type: integer
                    description: >-
                      Response status code


                      - **200**: Success - Request has been processed
                      successfully

                      - **401**: Unauthorized - Authentication credentials are
                      missing or invalid

                      - **402**: Insufficient Credits - Account does not have
                      enough credits to perform the operation

                      - **404**: Not Found - The requested resource or endpoint
                      does not exist

                      - **422**: Validation Error - The request parameters
                      failed validation checks

                      - **429**: Rate Limited - Request limit has been exceeded
                      for this resource

                      - **455**: Service Unavailable - System is currently
                      undergoing maintenance

                      - **500**: Server Error - An unexpected error occurred
                      while processing the request

                      - **501**: Generation Failed - Content generation task
                      failed

                      - **505**: Feature Disabled - The requested feature is
                      currently disabled
                  msg:
                    type: string
                    description: Response message, error description when failed
                  data:
                    type: object
                    properties: {}
                    x-apidog-orders: []
                    x-apidog-ignore-properties: []
                x-apidog-orders:
                  - code
                  - msg
                  - data
                required:
                  - code
                  - msg
                  - data
                x-apidog-ignore-properties: []
              example:
                code: 500
                msg: >-
                  Server Error - An unexpected error occurred while processing
                  the request
                data: null
          headers: {}
          x-apidog-name: 'Error '
      security:
        - BearerAuth: []
          x-apidog:
            schemeGroups:
              - id: kn8M4YUlc5i0A0179ezwx
                schemeIds:
                  - BearerAuth
            required: true
            use:
              id: kn8M4YUlc5i0A0179ezwx
            scopes:
              kn8M4YUlc5i0A0179ezwx:
                BearerAuth: []
      x-apidog-folder: docs/en/Market/Video Models/Wan
      x-apidog-status: released
      x-run-in-apidog: https://app.apidog.com/web/project/1184766/apis/api-28506419-run
components:
  schemas:
    ApiResponse:
      type: object
      properties:
        code:
          type: integer
          enum:
            - 200
            - 401
            - 402
            - 404
            - 422
            - 429
            - 455
            - 500
            - 501
            - 505
          description: >-
            Response status code


            - **200**: Success - Request has been processed successfully

            - **401**: Unauthorized - Authentication credentials are missing or
            invalid

            - **402**: Insufficient Credits - Account does not have enough
            credits to perform the operation

            - **404**: Not Found - The requested resource or endpoint does not
            exist

            - **422**: Validation Error - The request parameters failed
            validation checks

            - **429**: Rate Limited - Request limit has been exceeded for this
            resource

            - **455**: Service Unavailable - System is currently undergoing
            maintenance

            - **500**: Server Error - An unexpected error occurred while
            processing the request

            - **501**: Generation Failed - Content generation task failed

            - **505**: Feature Disabled - The requested feature is currently
            disabled
        msg:
          type: string
          description: Response message, error description when failed
          examples:
            - success
        data:
          type: object
          properties:
            taskId:
              type: string
              description: >-
                Task ID, can be used with Get Task Details endpoint to query
                task status
          x-apidog-orders:
            - taskId
          required:
            - taskId
          x-apidog-ignore-properties: []
      x-apidog-orders:
        - code
        - msg
        - data
      title: response not with recordId
      required:
        - data
      x-apidog-ignore-properties: []
      x-apidog-folder: ''
  securitySchemes:
    BearerAuth:
      type: bearer
      scheme: bearer
      bearerFormat: API Key
      description: |-
        所有 API 都需要通过 Bearer Token 进行身份验证。

        获取 API Key：
        1. 访问 [API Key 管理页面](https://kie.ai/api-key) 获取您的 API Key

        使用方法：
        在请求头中添加：
        Authorization: Bearer YOUR_API_KEY

        注意事项：
        - 请妥善保管您的 API Key，切勿泄露给他人
        - 若怀疑 API Key 泄露，请立即在管理页面重置
servers:
  - url: https://api.kie.ai
    description: 正式环境
security:
  - BearerAuth: []
    x-apidog:
      schemeGroups:
        - id: kn8M4YUlc5i0A0179ezwx
          schemeIds:
            - BearerAuth
      required: true
      use:
        id: kn8M4YUlc5i0A0179ezwx
      scopes:
        kn8M4YUlc5i0A0179ezwx:
          BearerAuth: []

```

Kie credit rate: $0.005 / credit
Kie HT bonus: +10% credits → ~10% lower effective cost
PiAPI: billed in USD/s directly — no credits
Your markup: 100% → Your price = 2 × provider HT/net cost
Veo 3.1 — Generate
POST /api/v1/veo/generate · veo3_fast or veo3
flat per video
Model	Type	Size	Cr	Kie std	Kie HT	Your price
veo3_fast	T2V · I2V · Ref2V	1080p 8s	60	$0.30	$0.27	$0.54
veo3	T2V · I2V	1080p 8s	250	$1.25	$1.13	$2.26
aspect_ratio: 16:9 · 9:16 · Auto · Audio included · Ref2V = Fast only · 4K billed separately
Veo 3.1 — Extend
POST /api/v1/veo/extend
flat per extension
Model	Mode	Cr	Kie std	Kie HT	Your price
veo3_fast	Fast	60	$0.30	$0.27	$0.54
veo3	Quality	250	$1.25	$1.13	$2.26
Veo 3.1 — Resolution Retrieval
Called after generate to upgrade output
flat per call
Endpoint	Output	Cr	Kie std	Kie HT	Your price
GET /veo/get-1080p-video	1080p render	5	$0.025	$0.023	$0.046
POST /veo/get-4k-video	4K upscale	120	$0.60	$0.54	$1.08
Total Fast+4K Kie HT = $0.27+$0.54 = $0.81 → your price $1.62 · Total Quality+4K Kie HT = $1.13+$0.54 = $1.67 → your price $3.34
Sora 2 Pro — I2V & T2V
sora-2-pro-image-to-video · sora-2-pro-text-to-video (same rate)
flat per video
size	n_frames	Dur	Cr	Kie std	Kie HT	Your price
standard 720p	10	10s	150	$0.75	$0.68	$1.36
standard 720p	15	15s	270	$1.35	$1.23	$2.46
high 1080p	10	10s	330	$1.65	$1.50	$3.00
high 1080p	15	15s	630	$3.15	$2.86	$5.72
aspect_ratio: portrait / landscape · remove_watermark included · character_id_list optional
Sora 2 Pro — Storyboard
sora-2-pro-storyboard
flat per video
Duration	Cr	Kie std	Kie HT	Your price
10s	150	$0.75	$0.675	$1.35
15–25s	270	$1.35	$1.215	$2.43
Kling 3.0
kling-3.0/video · /api/v1/jobs/createTask
per second
mode	sound	Cr/s	Kie std/s	Kie HT/s	5s your	10s your	15s your
std	off	14	$0.070	$0.063	$0.63	$1.26	$1.89
std	on	20	$0.100	$0.090	$0.90	$1.80	$2.70
pro	off	18	$0.090	$0.081	$0.81	$1.62	$2.43
pro	on	27	$0.135	$0.122	$1.22	$2.43	$3.65
std = 1280×720 · pro = higher res · multi_shots same rate · max 15s · kling_elements surcharge TBC
Kling 2.6 — T2V & I2V
kling-2.6/text-to-video · kling-2.6/image-to-video (same rate)
flat per clip
Duration	sound	Cr	Kie std	Kie HT	Your price
5s	off	55	$0.275	$0.25	$0.50
10s	off	110	$0.55	$0.50	$1.00
5s	on	110	$0.55	$0.50	$1.00
10s	on	220	$1.10	$1.00	$2.00
HD quality · audio = 2× no-audio credits · T2V and I2V identical rate · 3s bucket: confirm at kie.ai/pricing
Wan 2.2 — Animate Move
model: wan-2.2/animate-move · max 30s per job
per second
Resolution	Cr/s	Kie std/s	Kie HT/s	5s your	10s your	30s your
720p	12.5	$0.0625	$0.0563	$0.563	$1.13	$3.38
580p	9.5	$0.0475	$0.0428	$0.428	$0.855	$2.57
480p	6	$0.0300	$0.0270	$0.270	$0.540	$1.62
20–25% cheaper than official · max 30s per job · HT = 10% lower effective cost
Wan 2.2 — Animate Replace
model: wan-2.2/animate-replace · max 30s per job
per second
Resolution	Cr/s	Kie std/s	Kie HT/s	5s your	10s your	30s your
720p	12.5	$0.0625	$0.0563	$0.563	$1.13	$3.38
580p	9.5	$0.0475	$0.0428	$0.428	$0.855	$2.57
480p	6	$0.0300	$0.0270	$0.270	$0.540	$1.62
Identical rates to Animate Move · same 30s cap
Seedance 2 — PiAPI
POST https://api.piapi.ai/api/v1/task · billed in USD/s, no Kie credits
PiAPI · per second
Model	Mode	PiAPI $/s	5s your	8s your	10s your	15s your
seedance-2-preview	T2V · I2V	$0.15	$1.50	$2.40	$3.00	$4.50
seedance-2-fast-preview	T2V · I2V	$0.08	$0.80	$1.28	$1.60	$2.40
seedance-2-preview	Video Edit	$0.25	$2.50	$4.00	$5.00	$7.50
seedance-2-fast-preview	Video Edit	$0.13	$1.30	$2.08	$2.60	$3.90
No HT bonus — PiAPI charges USD/s directly · your price = 2 × PiAPI rate × seconds · optional image refs for subject/style control · video input for edit mode
Nano Banana — Image
/api/v1/jobs/createTask
flat per image
Model string	Backing model	Max res	Cr	Kie std	Kie HT	Your price
google/nano-banana	Gemini 2.5 Flash	1K	4	$0.020	$0.018	$0.036
google/nano-banana-2	Gemini 3.1 Flash	4K	8	$0.040	$0.036	$0.072
google/nano-banana-pro	Gemini 3 Pro	4K	24	$0.120	$0.109	$0.218
NB Pro ~20% cheaper than Google official · pricing may shift as model matures

