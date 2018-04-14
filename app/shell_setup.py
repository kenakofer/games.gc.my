# When this file is included, it allows calls to "flask shell" on
# the CLI to import these variables. Quite handy!
from app import app, db
from app.models import User, GameScore


@app.shell_context_processor
def make_shell_context():
    return {'db': db, 'User': User, 'GameScore':GameScore}
