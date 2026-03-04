import json
import sys
import traceback

def handler(event, context):
    try:
        from api.index import app
        from mangum import Mangum
        m = Mangum(app)
        return m(event, context)
    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({
                "error": str(e),
                "traceback": traceback.format_exc(),
                "python_version": sys.version,
                "path": sys.path
            }),
            "headers": {"Content-Type": "application/json"}
        }
